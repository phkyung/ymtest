// ─────────────────────────────────────────────
// CommentSection.jsx — 댓글 컴포넌트
// ─────────────────────────────────────────────
// targetId: 댓글이 달리는 대상 (showId 또는 actorId)
// targetType: 'show' 또는 'actor'
// ─────────────────────────────────────────────

import { useState, useEffect } from 'react'
import {
  collection, query, where, orderBy,
  onSnapshot, addDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { getNickname } from './NicknameModal'

// 더미 댓글 (Firebase 미연결 시 사용)
const DUMMY_COMMENTS = [
  {
    id: 'c1',
    nickname: '관람객A',
    text: '2막에서 눈물이 쏟아졌어요. 정말 명불허전.',
    userId: 'user_x',
    createdAt: new Date(Date.now() - 1000 * 60 * 30),
  },
  {
    id: 'c2',
    nickname: '뮤덕B',
    text: '대역 캐스팅도 정말 좋았습니다. 두 번 보길 잘 했어요.',
    userId: 'user_y',
    createdAt: new Date(Date.now() - 1000 * 60 * 120),
  },
]

function timeAgo(date) {
  if (!date) return ''
  const now = Date.now()
  const diff = now - (date instanceof Date ? date.getTime() : date.toDate?.().getTime?.() ?? now)
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return '방금 전'
  if (mins < 60)  return `${mins}분 전`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}시간 전`
  return `${Math.floor(hrs / 24)}일 전`
}

// 닉네임 첫 글자 아바타
function Avatar({ nickname }) {
  const initial = (nickname || '익')[0]
  // 닉네임 기반 색상 (고정적으로 배정)
  const colors = [
    'bg-[#8FAF94] text-white',
    'bg-[#A8C5AD] text-white',
    'bg-stone-400 text-white',
    'bg-amber-400 text-white',
    'bg-sky-400 text-white',
  ]
  const idx = (nickname?.charCodeAt(0) ?? 0) % colors.length
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${colors[idx]}`}>
      {initial}
    </div>
  )
}

export default function CommentSection({ targetId, targetType }) {
  const { user, signIn }   = useAuth()
  const [comments, setComments] = useState([])
  const [text, setText]   = useState('')
  const [loading, setLoading] = useState(false)
  const [localComments, setLocalComments] = useState(DUMMY_COMMENTS)

  // ── 댓글 로드 ──────────────────────────────────
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return

    const q = query(
      collection(db, 'comments'),
      where('targetId',   '==', targetId),
      where('targetType', '==', targetType),
      orderBy('createdAt', 'desc'),
    )

    const unsub = onSnapshot(q, snap => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [targetId, targetType])

  // ── 댓글 작성 ──────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || !user) return
    if (trimmed.length > 500) {
      alert('500자 이내로 입력해주세요.')
      return
    }

    setLoading(true)

    // 더미 모드
    if (!isFirebaseConfigured || !db) {
      setLocalComments(prev => [
        {
          id: `local_${Date.now()}`,
          text: trimmed,
          nickname: getNickname(),
          userId: user.uid,
          createdAt: new Date(),
        },
        ...prev,
      ])
      setText('')
      setLoading(false)
      return
    }

    try {
      await addDoc(collection(db, 'comments'), {
        targetId,
        targetType,
        text: trimmed,
        userId:   user.uid,
        nickname: getNickname(),
        createdAt: serverTimestamp(),
      })
      setText('')
    } catch (err) {
      console.error('댓글 작성 오류:', err)
    } finally {
      setLoading(false)
    }
  }

  // ── 댓글 삭제 ──────────────────────────────────
  async function handleDelete(commentId) {
    if (!window.confirm('댓글을 삭제할까요?')) return

    if (!isFirebaseConfigured || !db) {
      setLocalComments(prev => prev.filter(c => c.id !== commentId))
      return
    }

    try {
      await deleteDoc(doc(db, 'comments', commentId))
    } catch (err) {
      console.error('삭제 오류:', err)
    }
  }

  // Firebase 연결 여부에 따라 표시할 댓글 결정
  const displayComments = (isFirebaseConfigured && db) ? comments : localComments

  return (
    <div className="space-y-4">
      <h3 className="font-display text-base font-semibold text-stone-700">
        댓글{' '}
        <span className="text-stone-400 font-body font-normal text-sm">
          ({displayComments.length})
        </span>
      </h3>

      {/* 작성 폼 또는 로그인 안내 */}
      {user ? (
        <div className="space-y-2">
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSubmit(e)
              }}
              placeholder="이 공연에 대한 생각을 남겨주세요... (500자 이내)"
              maxLength={500}
              rows={2}
              className="flex-1 border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                         resize-none focus:outline-none focus:border-[#8FAF94]
                         focus:ring-1 focus:ring-[#8FAF94] placeholder:text-stone-300
                         transition-colors"
            />
            <button
              type="submit"
              disabled={!text.trim() || loading}
              className="px-4 py-2.5 bg-[#8FAF94] hover:bg-[#7A9E7F] text-white text-sm
                         font-medium rounded-xl transition-colors disabled:opacity-40 shrink-0"
            >
              {loading ? '...' : '등록'}
            </button>
          </form>
          <p className="text-xs text-stone-400 pl-1">
            <span className="text-[#8FAF94] font-medium">{getNickname()}</span>
            {' '}으로 등록 · Ctrl+Enter로 빠르게 등록
          </p>
        </div>
      ) : (
        /* 로그인 안내 카드 */
        <div className="border border-[#E8E4DF] rounded-xl p-4 bg-[#FAF8F5] flex flex-col sm:flex-row items-center gap-3">
          <div className="flex-1 text-center sm:text-left">
            <p className="text-sm font-medium text-[#2C1810]">로그인 후 댓글을 남겨보세요</p>
            <p className="text-xs text-stone-400 mt-0.5">공연 감상과 리뷰를 공유해요</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={signIn}
              className="flex items-center gap-1.5 px-3 py-2 border border-stone-200 rounded-xl
                         text-xs font-medium text-stone-600 bg-white hover:bg-stone-50 transition-colors"
            >
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt="Google"
                className="w-3.5 h-3.5"
              />
              Google
            </button>
            {/* 이메일 로그인은 LoginModal에서 처리 */}
          </div>
        </div>
      )}

      {/* 댓글 목록 */}
      {displayComments.length === 0 ? (
        <div className="py-10 flex flex-col items-center gap-2 text-stone-300">
          <span className="text-4xl">💬</span>
          <p className="text-sm text-stone-400">아직 댓글이 없습니다</p>
          <p className="text-xs text-stone-300">첫 번째 감상을 남겨보세요</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {displayComments.map(comment => (
            <li
              key={comment.id}
              className="flex gap-3 px-3 py-3 rounded-xl border border-stone-100
                         hover:bg-[#FAF8F5] hover:border-[#E8E4DF] transition-colors group"
            >
              {/* 아바타 */}
              <Avatar nickname={comment.nickname} />

              {/* 본문 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-stone-600">
                    {comment.nickname || '익명'}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-stone-300">{timeAgo(comment.createdAt)}</span>
                    {user && comment.userId === user.uid && (
                      <button
                        onClick={() => handleDelete(comment.id)}
                        className="text-xs text-stone-300 hover:text-red-400 transition-colors
                                   opacity-0 group-hover:opacity-100"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-stone-700 leading-relaxed">{comment.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
