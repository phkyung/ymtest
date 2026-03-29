// ─────────────────────────────────────────────
// PairVote.jsx — 페어 케미 키워드 (최대 4개)
// ─────────────────────────────────────────────
// Firestore 구조:
//   컬렉션: pairVotes
//   문서 ID: {showId}_{actorA}_{actorB} (가나다순 정렬)
//   필드: { [tag]: { count: number, voters: string[] } }
// ─────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import {
  doc, onSnapshot, setDoc, updateDoc,
  increment, arrayUnion, arrayRemove,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'
import { useAuth } from '../hooks/useAuth'

const BASIC_TAGS = ['팽팽한긴장', '다정함', '정석합', '엇갈림', '대립', '동반자', '밀당', '보호본능', '애증', '구원']
const MORE_TAGS  = ['공명', '합좋음', '주고받는맛', '시너지', '주도권싸움', '균형감', '침묵케미', '눈빛케미', '상처건드림', '서사합', '상호자극', '같이무너짐', '상호파괴']
const ALL_PAIR_TAGS = [...BASIC_TAGS, ...MORE_TAGS]
const MAX_SELECT = 4

const EMPTY_KEYWORDS = Object.fromEntries(ALL_PAIR_TAGS.map(t => [t, { count: 0, voted: false }]))

function getPairDocId(showId, idA, idB) {
  const [a, b] = [idA, idB].sort()
  return `${showId}_${a}_${b}`
}

function Toast({ message, visible }) {
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                     bg-[#2C1810] text-white rounded-lg px-4 py-2 text-sm
                     transition-all duration-300 pointer-events-none
                     ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
      {message}
    </div>
  )
}

export default function PairVote({ showId, cast }) {
  const { user } = useAuth()
  const [actorA, setActorA]     = useState(null)
  const [actorB, setActorB]     = useState(null)
  const [keywords, setKeywords] = useState(EMPTY_KEYWORDS)
  const [loading, setLoading]   = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [toast, setToast]       = useState({ visible: false, message: '' })

  const showToast = useCallback(msg => {
    setToast({ visible: true, message: msg })
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 2000)
  }, [])

  // 배우 선택: 이미 선택됐으면 해제, 아니면 A → B 순으로 채움
  function selectActor(actor) {
    if (actorA?.actorName === actor.actorName) { setActorA(null); return }
    if (actorB?.actorName === actor.actorName) { setActorB(null); return }
    if (!actorA) { setActorA(actor); return }
    if (!actorB) { setActorB(actor); return }
    setActorA(actor) // 둘 다 선택됐으면 A 교체
  }

  // ── 페어 Firestore 구독 ──────────────────────
  const idA = actorA?.resolvedId ?? null
  const idB = actorB?.resolvedId ?? null

  useEffect(() => {
    setKeywords(EMPTY_KEYWORDS)
    if (!idA || !idB || !isFirebaseConfigured || !db) return

    const docId = getPairDocId(showId, idA, idB)
    const unsub = onSnapshot(doc(db, 'pairVotes', docId), snap => {
      const data = snap.exists() ? snap.data() : {}
      setKeywords(Object.fromEntries(
        ALL_PAIR_TAGS.map(tag => {
          const d = data[tag] ?? {}
          return [tag, {
            count: d.count ?? 0,
            voted: user ? (d.voters ?? []).includes(user.uid) : false,
          }]
        })
      ))
    })
    return () => unsub()
  }, [showId, idA, idB, user])

  // ── 키워드 토글 ──────────────────────────────
  async function handleSelect(tag) {
    if (!user) {
      showToast('로그인 후 키워드를 선택할 수 있어요')
      return
    }
    if (!idA || !idB || loading) return

    const alreadySelected = keywords[tag]?.voted ?? false
    const selectedCount = ALL_PAIR_TAGS.filter(t => keywords[t]?.voted).length

    if (!alreadySelected && selectedCount >= MAX_SELECT) {
      showToast(`최대 ${MAX_SELECT}개까지 선택할 수 있어요`)
      return
    }

    setLoading(true)
    const docId = getPairDocId(showId, idA, idB)

    try {
      const kwRef = doc(db, 'pairVotes', docId)
      if (alreadySelected) {
        await updateDoc(kwRef, {
          [`${tag}.count`]:  increment(-1),
          [`${tag}.voters`]: arrayRemove(user.uid),
        })
      } else {
        await setDoc(kwRef, {
          [tag]: { count: increment(1), voters: arrayUnion(user.uid) },
        }, { merge: true })
      }
    } catch (err) {
      console.error('페어 키워드 오류:', err)
    } finally {
      setLoading(false)
    }
  }

  const pairReady = !!(actorA && actorB)
  const visibleTags = showMore ? ALL_PAIR_TAGS : BASIC_TAGS
  const selectedCount = ALL_PAIR_TAGS.filter(t => keywords[t]?.voted).length
  const maxReached = selectedCount >= MAX_SELECT

  return (
    <div className="space-y-4">
      <p className="text-xs text-stone-400">두 배우를 선택하면 케미를 기록할 수 있어요</p>

      {/* 배우 선택 */}
      <div className="flex flex-wrap gap-2">
        {cast.map((m, idx) => {
          const isA = actorA?.actorName === m.actorName
          const isB = actorB?.actorName === m.actorName
          return (
            <button
              key={idx}
              onClick={() => selectActor(m)}
              disabled={!m.resolvedId}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm
                          font-medium transition-colors disabled:opacity-30 ${
                isA
                  ? 'bg-[#2C1810] text-white'
                  : isB
                    ? 'bg-[#8FAF94] text-white'
                    : 'border border-[#C8D8CA] text-[#4A6B4F] hover:bg-[#8FAF94]/10'
              }`}
            >
              {(isA || isB) && (
                <span className="text-[10px] opacity-70 font-bold">{isA ? 'A' : 'B'}</span>
              )}
              {m.actorName}
            </button>
          )
        })}
      </div>

      {/* 선택 상태 표시 */}
      {pairReady ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="px-2.5 py-0.5 bg-[#2C1810]/10 text-[#2C1810] font-medium rounded-full">
            {actorA.actorName}
          </span>
          <span className="text-stone-300 text-xs">×</span>
          <span className="px-2.5 py-0.5 bg-[#8FAF94]/20 text-[#2C1810] font-medium rounded-full">
            {actorB.actorName}
          </span>
          <span className="text-xs text-stone-400 ml-0.5">케미</span>
        </div>
      ) : (
        <p className="text-xs text-stone-300">
          {actorA
            ? `${actorA.actorName} 선택됨 · 한 명 더 선택하세요`
            : '배우를 두 명 선택하세요'}
        </p>
      )}

      {/* 키워드 */}
      {pairReady && (
        <div className="space-y-3">
          <p className="text-xs text-stone-400">
            이 두 배우의 케미, 어떤 키워드가 떠오르나요?{' '}
            <span className="text-[#8FAF94]">(최대 {MAX_SELECT}개)</span>
          </p>

          <div className="flex flex-wrap gap-2">
            {visibleTags.map(tag => {
              const voted  = keywords[tag]?.voted ?? false
              const dimmed = maxReached && !voted
              return (
                <button
                  key={tag}
                  onClick={() => handleSelect(tag)}
                  disabled={loading || dimmed}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors select-none ${
                    voted
                      ? 'bg-[#8FAF94] text-white border-[#8FAF94]'
                      : dimmed
                        ? 'bg-white border-stone-200 text-stone-300 cursor-not-allowed'
                        : 'bg-white border-stone-200 text-stone-600 hover:border-[#8FAF94] hover:text-[#4A6B4F]'
                  }`}
                >
                  {tag}
                </button>
              )
            })}
          </div>

          <button
            onClick={() => setShowMore(v => !v)}
            className="text-xs text-[#8FAF94] underline"
          >
            {showMore ? '접기' : '더보기'}
          </button>
        </div>
      )}

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  )
}
