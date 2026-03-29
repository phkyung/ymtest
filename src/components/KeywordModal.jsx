// ─────────────────────────────────────────────
// KeywordModal.jsx — 노선&케미 키워드 기록 모달
// ─────────────────────────────────────────────

import { useState, useEffect } from 'react'
import {
  doc, getDoc, setDoc, updateDoc,
  increment, arrayUnion, arrayRemove,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { KEYWORD_CATEGORIES } from './KeywordVote'

const ALL_ACTOR_TAGS = KEYWORD_CATEGORIES.flatMap(c => c.tags)

const BASIC_PAIR_TAGS = ['팽팽한긴장', '다정함', '정석합', '엇갈림', '대립', '동반자', '밀당', '보호본능', '애증', '구원']
const MORE_PAIR_TAGS  = ['공명', '합좋음', '주고받는맛', '시너지', '주도권싸움', '균형감', '침묵케미', '눈빛케미', '상처건드림', '서사합', '상호자극', '같이무너짐', '상호파괴']
const ALL_PAIR_TAGS   = [...BASIC_PAIR_TAGS, ...MORE_PAIR_TAGS]

const MAX_SELECT = 4

function TagButton({ tag, voted, dimmed, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={dimmed}
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
}

export default function KeywordModal({ showId, actor, cast, onClose }) {
  const { user, signIn } = useAuth()

  // 배우 키워드 선택 (Set)
  const [actorSel, setActorSel]         = useState(new Set())
  const [initActorSel, setInitActorSel] = useState(new Set())

  // 페어 상태
  const [actorA, setActorA]         = useState(null)
  const [actorB, setActorB]         = useState(null)
  const [pairSel, setPairSel]       = useState(new Set())
  const [initPairSel, setInitPairSel] = useState(new Set())
  const [showMorePair, setShowMorePair] = useState(false)

  const [loadingInit, setLoadingInit] = useState(true)
  const [saving, setSaving]           = useState(false)
  const [toast, setToast]             = useState({ visible: false, message: '' })

  function showToast(msg) {
    setToast({ visible: true, message: msg })
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 2500)
  }

  // ── 배우 키워드 초기 로드 ────────────────────
  useEffect(() => {
    if (!actor?.resolvedId || !isFirebaseConfigured || !db || !user) {
      setLoadingInit(false)
      return
    }
    getDoc(doc(db, 'keywords', `${showId}_${actor.resolvedId}`))
      .then(snap => {
        if (snap.exists()) {
          const data = snap.data()
          const myVotes = new Set(
            ALL_ACTOR_TAGS.filter(t => (data[t]?.voters ?? []).includes(user.uid))
          )
          setInitActorSel(myVotes)
          setActorSel(new Set(myVotes))
        }
      })
      .finally(() => setLoadingInit(false))
  }, [showId, actor?.resolvedId, user])

  // ── 페어 선택 시 초기 로드 ───────────────────
  const idA = actorA?.resolvedId ?? null
  const idB = actorB?.resolvedId ?? null

  useEffect(() => {
    setPairSel(new Set())
    setInitPairSel(new Set())
    if (!idA || !idB || !isFirebaseConfigured || !db || !user) return
    const [a, b] = [idA, idB].sort()
    getDoc(doc(db, 'pairVotes', `${showId}_${a}_${b}`)).then(snap => {
      if (snap.exists()) {
        const data = snap.data()
        const myVotes = new Set(
          ALL_PAIR_TAGS.filter(t => (data[t]?.voters ?? []).includes(user.uid))
        )
        setInitPairSel(myVotes)
        setPairSel(new Set(myVotes))
      }
    })
  }, [showId, idA, idB, user])

  // ── 태그 토글 ────────────────────────────────
  function toggleActorTag(tag) {
    if (!user) { showToast('로그인 후 키워드를 선택할 수 있어요'); return }
    setActorSel(prev => {
      const next = new Set(prev)
      if (next.has(tag)) { next.delete(tag); return next }
      if (next.size >= MAX_SELECT) {
        showToast(`최대 ${MAX_SELECT}개까지 선택할 수 있어요`)
        return prev
      }
      next.add(tag)
      return next
    })
  }

  function togglePairTag(tag) {
    if (!user) { showToast('로그인 후 키워드를 선택할 수 있어요'); return }
    setPairSel(prev => {
      const next = new Set(prev)
      if (next.has(tag)) { next.delete(tag); return next }
      if (next.size >= MAX_SELECT) {
        showToast(`최대 ${MAX_SELECT}개까지 선택할 수 있어요`)
        return prev
      }
      next.add(tag)
      return next
    })
  }

  // ── 페어 배우 선택 ───────────────────────────
  function selectPairActor(m) {
    if (actorA?.actorName === m.actorName) { setActorA(null); return }
    if (actorB?.actorName === m.actorName) { setActorB(null); return }
    if (!actorA) { setActorA(m); return }
    if (!actorB) { setActorB(m); return }
    setActorA(m)
  }

  // ── 저장 ─────────────────────────────────────
  async function handleSave() {
    if (!user) { showToast('로그인 후 이용할 수 있어요'); return }
    if (saving) return
    setSaving(true)

    try {
      if (actor?.resolvedId && isFirebaseConfigured && db) {
        const kwRef   = doc(db, 'keywords', `${showId}_${actor.resolvedId}`)
        const showRef = doc(db, 'shows', showId)

        const addTags    = ALL_ACTOR_TAGS.filter(t => actorSel.has(t) && !initActorSel.has(t))
        const removeTags = ALL_ACTOR_TAGS.filter(t => !actorSel.has(t) && initActorSel.has(t))

        const writes = []
        if (addTags.length > 0) {
          const data = {}
          addTags.forEach(t => { data[t] = { count: increment(1), voters: arrayUnion(user.uid) } })
          writes.push(setDoc(kwRef, data, { merge: true }))
        }
        if (removeTags.length > 0) {
          const data = {}
          removeTags.forEach(t => {
            data[`${t}.count`]  = increment(-1)
            data[`${t}.voters`] = arrayRemove(user.uid)
          })
          writes.push(updateDoc(kwRef, data))
        }
        await Promise.all(writes)

        // topKeywords 업데이트
        const kwSnap = await getDoc(kwRef)
        if (kwSnap.exists()) {
          const kwData = kwSnap.data()
          const topKeywords = ALL_ACTOR_TAGS
            .map(t => ({ tag: t, count: kwData[t]?.count ?? 0 }))
            .filter(x => x.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 3)
            .map(x => x.tag)
          await updateDoc(showRef, { topKeywords })
        }
      }

      // 페어 키워드 저장
      if (idA && idB && isFirebaseConfigured && db) {
        const [a, b] = [idA, idB].sort()
        const pairRef = doc(db, 'pairVotes', `${showId}_${a}_${b}`)

        const addPair    = ALL_PAIR_TAGS.filter(t => pairSel.has(t) && !initPairSel.has(t))
        const removePair = ALL_PAIR_TAGS.filter(t => !pairSel.has(t) && initPairSel.has(t))

        const writes = []
        if (addPair.length > 0) {
          const data = {}
          addPair.forEach(t => { data[t] = { count: increment(1), voters: arrayUnion(user.uid) } })
          writes.push(setDoc(pairRef, data, { merge: true }))
        }
        if (removePair.length > 0) {
          const data = {}
          removePair.forEach(t => {
            data[`${t}.count`]  = increment(-1)
            data[`${t}.voters`] = arrayRemove(user.uid)
          })
          writes.push(updateDoc(pairRef, data))
        }
        await Promise.all(writes)
      }

      showToast('키워드가 기록됐어요 🙌')
      setTimeout(onClose, 1600)
    } catch (err) {
      console.error('키워드 저장 오류:', err)
      showToast('저장 중 오류가 발생했어요')
    } finally {
      setSaving(false)
    }
  }

  const actorMaxReached = actorSel.size >= MAX_SELECT
  const pairMaxReached  = pairSel.size >= MAX_SELECT
  const pairReady       = !!(actorA && actorB)
  const visiblePairTags = showMorePair ? ALL_PAIR_TAGS : BASIC_PAIR_TAGS

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 shrink-0">
          <h2 className="font-display text-base font-semibold text-[#2C1810]">노선&케미</h2>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* 본문 스크롤 */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-6">

          {/* ── 배우 노선 키워드 ── */}
          <section className="space-y-3">
            <div>
              <p className="text-sm font-medium text-[#2C1810]">
                {actor?.actorName}
                {actor?.roleName?.trim() && (
                  <span className="text-stone-400 font-normal text-xs ml-1.5">
                    {actor.roleName} 역
                  </span>
                )}
              </p>
              <p className="text-xs text-stone-400 mt-0.5">
                이 배우의 이 역할, 어떤 키워드가 떠오르나요?{' '}
                <span className="text-[#8FAF94]">(최대 {MAX_SELECT}개)</span>
              </p>
            </div>

            {loadingInit ? (
              <p className="text-xs text-stone-300">로딩 중...</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {ALL_ACTOR_TAGS.map(tag => (
                  <TagButton
                    key={tag}
                    tag={tag}
                    voted={actorSel.has(tag)}
                    dimmed={actorMaxReached && !actorSel.has(tag)}
                    onClick={() => toggleActorTag(tag)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── 페어 케미 ── */}
          <section className="space-y-3 pt-4 border-t border-stone-100">
            <p className="text-sm font-medium text-[#2C1810]">페어 케미도 기록해보세요</p>

            {/* 배우 선택 */}
            <div className="flex flex-wrap gap-2">
              {cast.map((m, idx) => {
                const isA = actorA?.actorName === m.actorName
                const isB = actorB?.actorName === m.actorName
                return (
                  <button
                    key={idx}
                    onClick={() => selectPairActor(m)}
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

            {pairReady ? (
              <>
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

                <p className="text-xs text-stone-400">
                  이 두 배우의 케미, 어떤 키워드가 떠오르나요?{' '}
                  <span className="text-[#8FAF94]">(최대 {MAX_SELECT}개)</span>
                </p>

                <div className="flex flex-wrap gap-2">
                  {visiblePairTags.map(tag => (
                    <TagButton
                      key={tag}
                      tag={tag}
                      voted={pairSel.has(tag)}
                      dimmed={pairMaxReached && !pairSel.has(tag)}
                      onClick={() => togglePairTag(tag)}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setShowMorePair(v => !v)}
                  className="text-xs text-[#8FAF94] underline"
                >
                  {showMorePair ? '접기' : '더보기'}
                </button>
              </>
            ) : (
              <p className="text-xs text-stone-300">
                {actorA
                  ? `${actorA.actorName} 선택됨 · 한 명 더 선택하세요`
                  : '배우를 두 명 선택하면 케미 키워드를 기록할 수 있어요'}
              </p>
            )}
          </section>
        </div>

        {/* 하단 버튼 */}
        <div className="px-5 py-4 border-t border-stone-100 shrink-0">
          {!user ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-stone-400">로그인 후 키워드를 기록할 수 있어요</p>
              <button
                onClick={signIn}
                className="shrink-0 text-xs px-4 py-2 bg-[#8FAF94] text-white rounded-xl
                           font-medium hover:bg-[#7A9E7F] transition-colors"
              >
                로그인이 필요해요
              </button>
            </div>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3 bg-[#8FAF94] hover:bg-[#7A9E7F] text-white font-medium
                         rounded-xl transition-colors disabled:opacity-50"
            >
              {saving ? '기록 중...' : '기록하기'}
            </button>
          )}
        </div>
      </div>

      {/* 토스트 */}
      <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60]
                       bg-[#2C1810] text-white rounded-lg px-4 py-2 text-sm
                       transition-all duration-300 pointer-events-none
                       ${toast.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
        {toast.message}
      </div>
    </div>
  )
}
