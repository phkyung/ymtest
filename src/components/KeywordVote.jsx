// ─────────────────────────────────────────────
// KeywordVote.jsx — 배우-공연 조합 키워드 투표
// ─────────────────────────────────────────────
// Firestore 구조:
//   컬렉션: keywords
//   문서 ID: {showId}_{actorId}
//   필드: { [tag]: { count: number, voters: string[] } }
// ─────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import {
  doc, onSnapshot, setDoc, updateDoc,
  increment, arrayUnion, arrayRemove,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'
import { useAuth } from '../hooks/useAuth'

export const KEYWORD_CATEGORIES = [
  {
    label: '이 캐릭터의 결',
    tags: ['서늘함', '따뜻함', '건조함', '날것', '단단함', '연약함', '위태로움', '기품'],
  },
  {
    label: '이 캐릭터를 움직이는 힘',
    tags: ['인정욕', '구원욕', '복수심', '생존욕', '통제욕', '헌신', '자기파괴', '도피'],
  },
  {
    label: '상대를 대하는 방식',
    tags: ['직진', '회피', '헌신', '지배', '유혹', '거리두기', '소유욕', '보호본능'],
  },
  {
    label: '배우가 감정을 푸는 방식',
    tags: ['절제', '누름', '지연폭발', '속울음', '스며듦', '냉소', '폭발'],
  },
  {
    label: '보고 나서 남는 것',
    tags: ['아릿함', '먹먹함', '처연함', '섬뜩함', '통쾌함', '허무', '선연함', '비장미'],
  },
]

const ALL_TAGS = KEYWORD_CATEGORIES.flatMap(c => c.tags)

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
  const { user, signIn } = useAuth()
  // votes: { [tag]: { count: number, voted: boolean } }
  const [votes, setVotes]   = useState({})
  const [loading, setLoading] = useState(false)
  const [toast, setToast]   = useState({ visible: false, message: '' })

  const showToast = useCallback(msg => {
    setToast({ visible: true, message: msg })
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 2000)
  }, [])

  // ── 투표 데이터 로드 ─────────────────────────
  useEffect(() => {
    if (!showId || !actorId) return
    const docId = `${showId}_${actorId}`

    if (!isFirebaseConfigured || !db) {
      const local = localStore[docId] ?? {}
      setVotes(Object.fromEntries(
        ALL_TAGS.map(tag => [tag, {
          count: local[tag]?.count ?? 0,
          voted: local[tag]?.voted ?? false,
        }])
      ))
      return
    }

    const unsub = onSnapshot(doc(db, 'keywords', docId), snap => {
      const data = snap.exists() ? snap.data() : {}
      setVotes(Object.fromEntries(
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

  // ── 투표 토글 ───────────────────────────────
  async function handleVote(tag) {
    if (!user) {
      showToast('투표하려면 로그인이 필요해요 😊')
      return
    }
    if (loading) return
    setLoading(true)

    const docId = `${showId}_${actorId}`
    const alreadyVoted = votes[tag]?.voted ?? false

    if (!isFirebaseConfigured || !db) {
      const local = localStore[docId] ?? {}
      local[tag] = alreadyVoted
        ? { count: Math.max(0, (local[tag]?.count ?? 1) - 1), voted: false }
        : { count: (local[tag]?.count ?? 0) + 1, voted: true }
      localStore[docId] = local
      setVotes(prev => ({ ...prev, [tag]: { count: local[tag].count, voted: local[tag].voted } }))
      setLoading(false)
      return
    }

    try {
      const docRef = doc(db, 'keywords', docId)
      if (alreadyVoted) {
        await updateDoc(docRef, {
          [`${tag}.count`]:  increment(-1),
          [`${tag}.voters`]: arrayRemove(user.uid),
        })
      } else {
        await setDoc(docRef, {
          [tag]: { count: increment(1), voters: arrayUnion(user.uid) },
        }, { merge: true })
      }
    } catch (err) {
      console.error('투표 오류:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {KEYWORD_CATEGORIES.map((cat, idx) => (
        <div key={cat.label}>
          {idx > 0 && <hr className="border-stone-100 mb-4" />}

          <p className="text-xs text-[#8FAF94] font-medium mb-2">{cat.label}</p>

          <div className="flex flex-wrap gap-2">
            {cat.tags.map(tag => {
              const count = votes[tag]?.count ?? 0
              const voted = votes[tag]?.voted ?? false
              return (
                <button
                  key={tag}
                  onClick={() => handleVote(tag)}
                  disabled={loading}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm
                              font-medium border transition-all duration-150 min-h-[40px] select-none
                              ${voted
                                ? 'bg-[#8FAF94] border-[#8FAF94] text-[#2C1810]'
                                : 'bg-white border-[#C8D8CA] text-[#4A6B4F] hover:bg-[#8FAF94]/10 hover:border-[#8FAF94]'
                              }`}
                >
                  <span>{tag}</span>
                  {count > 0 && (
                    <span className={`text-xs font-semibold ${voted ? 'text-[#2C1810]/60' : 'text-stone-400'}`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {!user && (
        <p className="text-xs text-stone-400 pt-1">
          로그인하면 키워드를 투표할 수 있어요 ·{' '}
          <button onClick={signIn} className="text-[#4A6B4F] underline hover:text-[#7A9E7F]">
            구글 로그인
          </button>
        </p>
      )}

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  )
}
