// ─────────────────────────────────────────────
// useAuth.js — Firebase 구글 로그인 훅
// ─────────────────────────────────────────────
// 투표, 댓글 작성에 사용됩니다.
// ─────────────────────────────────────────────

import { useState, useEffect } from 'react'
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { auth, isFirebaseConfigured } from '../firebase'

export function useAuth() {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Firebase 미설정 시 비로그인 상태로 시작
    if (!isFirebaseConfigured || !auth) {
      setLoading(false)
      return
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser ?? null)
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  async function signIn() {
    if (!isFirebaseConfigured || !auth) return
    const provider = new GoogleAuthProvider()
    try {
      await signInWithPopup(auth, provider)
    } catch (err) {
      console.error('구글 로그인 실패:', err)
    }
  }

  async function signOut() {
    if (!isFirebaseConfigured || !auth) return
    try {
      await firebaseSignOut(auth)
    } catch (err) {
      console.error('로그아웃 실패:', err)
    }
  }

  return { user, loading, signIn, signOut }
}
