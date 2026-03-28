// ─────────────────────────────────────────────
// useAuth.js — Firebase 익명 로그인 훅
// ─────────────────────────────────────────────
// 사용자가 페이지를 열면 자동으로 익명 로그인합니다.
// 투표, 댓글 작성에 사용됩니다.
// ─────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import { auth, isFirebaseConfigured } from '../firebase'

export function useAuth() {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Firebase 미설정 시 더미 UID 반환 (로컬 개발용)
    if (!isFirebaseConfigured || !auth) {
      setUser({ uid: 'local_dev_user', isAnonymous: true })
      setLoading(false)
      return
    }

    // Auth 상태 변화 감지
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser)
      } else {
        // 로그인 안 된 상태면 익명으로 자동 로그인
        try {
          const credential = await signInAnonymously(auth)
          setUser(credential.user)
        } catch (err) {
          console.error('익명 로그인 실패:', err)
        }
      }
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  return { user, loading }
}
