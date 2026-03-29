// ─────────────────────────────────────────────
// KeywordVote.jsx — 배우 노선 키워드 (최대 4개)
// ─────────────────────────────────────────────
// Firestore 구조:
//   컬렉션: keywords
//   문서 ID: {showId}_{actorId}
//   필드: { [tag]: { count: number, voters: string[] } }
// ─────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import {
  doc, getDoc, onSnapshot, setDoc, updateDoc,
  increment, arrayUnion, arrayRemove, serverTimestamp,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'
import { useAuth } from '../hooks/useAuth'

export const KEYWORD_CATEGORIES = [
  {
    label: '이 캐릭터의 결',
    tags: [
      '서늘함', '따뜻함', '건조함', '날것', '단단함', '연약함', '위태로움', '기품',
      '자신감', '오만함', '비겁함', '피폐함',
      '순수함', '명랑함', '유쾌함', '해맑음', '생동감',
    ],
  },
  {
    label: '이 캐릭터를 움직이는 힘',
    tags: [
      '인정욕', '구원욕', '복수심', '생존욕', '통제욕', '자기파괴',
      '사랑', '호기심', '희망', '용기',
    ],
  },
  {
    label: '상대를 대하는 방식',
    tags: [
      '직진', '회피', '헌신', '지배', '유혹', '거리두기', '소유욕', '보호본능',
      '다정함', '솔직함', '개방적',
    ],
  },
  {
    label: '배우가 감정을 푸는 방식',
    tags: ['절제', '냉소', '폭발', '활짝', '경쾌함', '자연스러움'],
  },
  {
    label: '보고 나서 남는 것',
    tags: [
      '먹먹함', '처연함', '섬뜩함', '통쾌함', '허무', '비장미',
      '따스함', '설렘', '미소', '흐뭇함',
    ],
  },
]

const ALL_TAGS = KEYWORD_CATEGORIES.flatMap(c => c.tags)
const MAX_SELECT = 4

// 더미 모드 로컬 상태
const localStore = {}

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

export default function KeywordVote({ showId, actorId }) {
  const { user } = useAuth()
  const [keywords, setKeywords] = useState({})
  const [loading, setLoading]   = useState(false)
  const [toast, setToast]       = useState({ visible: false, message: '' })

  const showToast = useCallback(msg => {
    setToast({ visible: true, message: msg })
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 2000)
  }, [])

  // ── 키워드 데이터 로드 ───────────────────────
  useEffect(() => {
    if (!showId || !actorId) return
    const docId = `${showId}_${actorId}`

    if (!isFirebaseConfigured || !db) {
      const local = localStore[docId] ?? {}
      setKeywords(Object.fromEntries(
        ALL_TAGS.map(tag => [tag, {
          count: local[tag]?.count ?? 0,
          voted: local[tag]?.voted ?? false,
        }])
      ))
      return
    }

    const unsub = onSnapshot(doc(db, 'keywords', docId), snap => {
      const data = snap.exists() ? snap.data() : {}
      setKeywords(Object.fromEntries(
        ALL_TAGS.map(tag => {
          const d = data[tag] ?? {}
          return [tag, {
            count: d.count ?? 0,
            voted: user ? (d.voters ?? []).includes(user.uid) : false,
          }]
        })
      ))
    })
    return () => unsub()
  }, [showId, actorId, user])

  // ── 키워드 토글 ──────────────────────────────
  async function handleSelect(tag) {
    if (!user) {
      showToast('로그인 후 키워드를 선택할 수 있어요')
      return
    }
    if (loading) return

    const alreadySelected = keywords[tag]?.voted ?? false
    const selectedCount = ALL_TAGS.filter(t => keywords[t]?.voted).length

    if (!alreadySelected && selectedCount >= MAX_SELECT) {
      showToast(`최대 ${MAX_SELECT}개까지 선택할 수 있어요`)
      return
    }

    setLoading(true)
    const docId = `${showId}_${actorId}`

    if (!isFirebaseConfigured || !db) {
      const local = localStore[docId] ?? {}
      local[tag] = alreadySelected
        ? { count: Math.max(0, (local[tag]?.count ?? 1) - 1), voted: false }
        : { count: (local[tag]?.count ?? 0) + 1, voted: true }
      localStore[docId] = local
      setKeywords(prev => ({ ...prev, [tag]: { count: local[tag].count, voted: local[tag].voted } }))
      setLoading(false)
      return
    }

    // 토글 후 내 선택 태그 목록 계산
    const newMyTags = ALL_TAGS.filter(t => {
      if (t === tag) return !alreadySelected
      return keywords[t]?.voted ?? false
    })

    try {
      const kwRef      = doc(db, 'keywords', docId)
      const showRef    = doc(db, 'shows', showId)
      const myKwRef    = doc(db, 'userKeywords', `${user.uid}_${docId}`)

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

      // 내 키워드 기록 저장
      await setDoc(myKwRef, {
        tags:      newMyTags,
        showId,
        actorId,
        userId:    user.uid,
        updatedAt: serverTimestamp(),
      })

      // 최신 집계로 topKeywords 업데이트
      const kwSnap = await getDoc(kwRef)
      if (kwSnap.exists()) {
        const data = kwSnap.data()
        const topKeywords = ALL_TAGS
          .map(t => ({ tag: t, count: data[t]?.count ?? 0 }))
          .filter(x => x.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 3)
          .map(x => x.tag)
        await updateDoc(showRef, { topKeywords })
      }
    } catch (err) {
      console.error('키워드 오류:', err)
    } finally {
      setLoading(false)
    }
  }

  // 투표수 내림차순 → 0표는 가나다순
  const sortedTags = [...ALL_TAGS].sort((a, b) => {
    const ca = keywords[a]?.count ?? 0
    const cb = keywords[b]?.count ?? 0
    if (cb !== ca) return cb - ca
    return a.localeCompare(b, 'ko')
  })

  const selectedCount = ALL_TAGS.filter(t => keywords[t]?.voted).length
  const maxReached = selectedCount >= MAX_SELECT

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-400">
        이 배우의 이 역할, 어떤 키워드가 떠오르나요?{' '}
        <span className="text-[#8FAF94]">(최대 {MAX_SELECT}개)</span>
      </p>

      <div className="flex flex-wrap gap-2">
        {sortedTags.map(tag => {
          const voted   = keywords[tag]?.voted ?? false
          const dimmed  = maxReached && !voted
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

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  )
}
