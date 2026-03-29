// ─────────────────────────────────────────────
// KeywordVote.jsx — 배우-공연-배역 조합에 키워드 투표
// ─────────────────────────────────────────────
// 구조: Firestore "votes" 컬렉션
//   문서 ID = "{showId}_{actorId}_{keyword}"
//   필드: count(숫자), voterIds(배열), showId, actorId, keyword
// ─────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import {
  doc, getDoc, setDoc,
  updateDoc, arrayUnion, arrayRemove, increment, onSnapshot,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'
import { useAuth } from '../hooks/useAuth'

// MVP에서 사용할 키워드 목록 (나중에 Firestore에서 관리 가능)
const PRESET_KEYWORDS = [
  '카리스마', '섬세함', '코믹', '광기', '서정적',
  '압도적', '따뜻함', '냉혹함', '몰입감', '유머',
  '절제', '폭발적', '고독', '순수', '복잡한 내면',
]

// 로컬(더미) 투표 상태 관리 — Firebase 미연결 시 사용
const localVotes = {}

// ── 토스트 컴포넌트 ──────────────────────────
function Toast({ message, visible }) {
  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                  bg-[#2C1810] text-white rounded-lg px-4 py-2 text-sm
                  transition-all duration-300 pointer-events-none
                  ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
    >
      {message}
    </div>
  )
}

export default function KeywordVote({ showId, actorId, roleName }) {
  const { user, signIn } = useAuth()
  const [votes, setVotes]         = useState({}) // { keyword: { count, voted } }
  const [loading, setLoading]     = useState(false)
  const [toast, setToast]         = useState({ visible: false, message: '' })

  // ── 토스트 표시 ──────────────────────────────
  const showToast = useCallback((message) => {
    setToast({ visible: true, message })
    setTimeout(() => setToast({ visible: false, message }), 2000)
  }, [])

  // ── 투표 데이터 로드 ──────────────────────────
  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      // 더미 모드: 로컬 상태만 사용
      const initial = {}
      PRESET_KEYWORDS.forEach(kw => {
        initial[kw] = {
          count: localVotes[`${showId}_${actorId}_${kw}`]?.count ?? 0,
          voted: localVotes[`${showId}_${actorId}_${kw}`]?.voted ?? false,
        }
      })
      setVotes(initial)
      return
    }

    // Firestore 실시간 구독
    const unsubs = PRESET_KEYWORDS.map(kw => {
      const docId  = `${showId}_${actorId}_${kw}`
      const docRef = doc(db, 'votes', docId)

      return onSnapshot(docRef, snap => {
        if (snap.exists()) {
          const data   = snap.data()
          const voted  = user ? data.voterIds?.includes(user.uid) : false
          setVotes(prev => ({
            ...prev,
            [kw]: { count: data.count ?? 0, voted },
          }))
        } else {
          setVotes(prev => ({ ...prev, [kw]: { count: 0, voted: false } }))
        }
      })
    })

    return () => unsubs.forEach(u => u())
  }, [showId, actorId, user])

  // ── 투표 처리 ──────────────────────────────────
  async function handleVote(keyword) {
    if (!user) {
      showToast('투표하려면 로그인이 필요해요 😊')
      return
    }
    if (loading) return
    setLoading(true)

    const key    = `${showId}_${actorId}_${keyword}`
    const alreadyVoted = votes[keyword]?.voted

    // 더미 모드
    if (!isFirebaseConfigured || !db) {
      if (alreadyVoted) {
        localVotes[key] = {
          count: Math.max(0, (localVotes[key]?.count ?? 1) - 1),
          voted: false,
        }
        setVotes(prev => ({
          ...prev,
          [keyword]: { count: Math.max(0, (prev[keyword]?.count ?? 1) - 1), voted: false },
        }))
      } else {
        localVotes[key] = {
          count: (localVotes[key]?.count ?? 0) + 1,
          voted: true,
        }
        setVotes(prev => ({
          ...prev,
          [keyword]: { count: (prev[keyword]?.count ?? 0) + 1, voted: true },
        }))
      }
      setLoading(false)
      return
    }

    // Firestore 업데이트
    try {
      const docRef = doc(db, 'votes', key)
      const snap   = await getDoc(docRef)

      if (alreadyVoted) {
        // 투표 취소
        if (snap.exists()) {
          await updateDoc(docRef, {
            count: increment(-1),
            voterIds: arrayRemove(user.uid),
          })
        }
      } else {
        // 투표 추가
        if (snap.exists()) {
          await updateDoc(docRef, {
            count: increment(1),
            voterIds: arrayUnion(user.uid),
          })
        } else {
          await setDoc(docRef, {
            showId, actorId, keyword,
            count: 1,
            voterIds: [user.uid],
            createdAt: new Date(),
          })
        }
      }
    } catch (err) {
      console.error('투표 오류:', err)
    } finally {
      setLoading(false)
    }
  }

  // 득표 순으로 정렬
  const sorted = PRESET_KEYWORDS.slice().sort(
    (a, b) => (votes[b]?.count ?? 0) - (votes[a]?.count ?? 0)
  )

  return (
    <div>
      <h3 className="font-display text-base font-semibold text-stone-700 mb-3">
        {roleName} 역 · 키워드 투표
        <span className="ml-2 text-xs font-body text-stone-400 font-normal">
          공감되는 키워드를 눌러주세요
        </span>
      </h3>

      <div className="flex flex-wrap gap-2">
        {sorted.map(kw => {
          const count = votes[kw]?.count ?? 0
          const voted = votes[kw]?.voted ?? false

          return (
            <button
              key={kw}
              onClick={() => handleVote(kw)}
              disabled={voted || loading}
              className={`keyword-badge ${voted ? 'keyword-badge-voted' : 'keyword-badge-unvoted'}`}
            >
              <span>{kw}</span>
              {count > 0 && (
                <span className={`text-xs font-medium ${voted ? 'text-white/70' : 'text-stone-400'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {!user && (
        <p className="text-xs text-stone-400 mt-3">
          로그인하면 공감 키워드를 투표할 수 있어요 ·{' '}
          <button onClick={signIn} className="text-[#4A6B4F] underline hover:text-[#7A9E7F]">
            구글 로그인
          </button>
        </p>
      )}

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  )
}
