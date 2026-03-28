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

// 더미 댓글 (Firebase 미연결 시 사용)
const DUMMY_COMMENTS = [
  {
    id: 'c1',
    text: '2막에서 눈물이 쏟아졌어요. 정말 명불허전.',
    userId: 'user_x',
    createdAt: new Date(Date.now() - 1000 * 60 * 30),
  },
  {
    id: 'c2',
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

export default function CommentSection({ targetId, targetType }) {
  const { user }           = useAuth()
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
        { id: `local_${Date.now()}`, text: trimmed, userId: user.uid, createdAt: new Date() },
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
        userId: user.uid,
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
        댓글 <span className="text-stone-400 font-body font-normal text-sm">({displayComments.length})</span>
      </h3>

      {/* 작성 폼 */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            // Ctrl+Enter 또는 Cmd+Enter 로 제출
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSubmit(e)
          }}
          placeholder="이 공연에 대한 생각을 남겨주세요... (500자 이내)"
          maxLength={500}
          rows={2}
          className="flex-1 border border-stone-200 rounded-lg px-3 py-2 text-sm
                     resize-none focus:outline-none focus:ring-2 focus:ring-amber-300
                     placeholder:text-stone-300"
        />
        <button
          type="submit"
          disabled={!text.trim() || loading}
          className="px-4 py-2 bg-stone-800 text-white text-sm rounded-lg
                     hover:bg-amber-700 transition-colors disabled:opacity-40
                     self-end shrink-0"
        >
          등록
        </button>
      </form>
      <p className="text-xs text-stone-400">Ctrl+Enter로 빠르게 등록</p>

      {/* 댓글 목록 */}
      {displayComments.length === 0 ? (
        <p className="text-stone-400 text-sm py-4 text-center">
          아직 댓글이 없습니다. 첫 댓글을 남겨보세요!
        </p>
      ) : (
        <ul className="space-y-3">
          {displayComments.map(comment => (
            <li
              key={comment.id}
              className="bg-white border border-stone-100 rounded-lg px-4 py-3"
            >
              <div className="flex justify-between items-start gap-2">
                <p className="text-sm text-stone-700 leading-relaxed flex-1">
                  {comment.text}
                </p>
                {/* 내 댓글이면 삭제 버튼 */}
                {user && comment.userId === user.uid && (
                  <button
                    onClick={() => handleDelete(comment.id)}
                    className="text-xs text-stone-300 hover:text-red-400 transition-colors shrink-0"
                  >
                    삭제
                  </button>
                )}
              </div>
              <p className="text-xs text-stone-300 mt-1.5">
                {timeAgo(comment.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
