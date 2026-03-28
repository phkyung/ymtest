// ─────────────────────────────────────────────
// useShows.js — 공연 목록 데이터 훅
// ─────────────────────────────────────────────
// Firebase 연결 시 → Firestore에서 실시간 로드
// Firebase 미연결 시 → sampleShows.json 더미 사용
// ─────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'
import sampleShows from '../data/sampleShows.json'

export function useShows() {
  const [shows, setShows]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    // Firebase 미설정 시 더미 데이터
    if (!isFirebaseConfigured || !db) {
      setShows(sampleShows)
      setLoading(false)
      return
    }

    // Firestore 실시간 구독
    const q = query(collection(db, 'shows'), orderBy('startDate', 'asc'))
    const unsub = onSnapshot(
      q,
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        // Firestore에 데이터 없으면 더미 폴백
        setShows(data.length > 0 ? data : sampleShows)
        setLoading(false)
      },
      err => {
        console.error('공연 데이터 로드 오류:', err)
        setError(err)
        setShows(sampleShows) // 오류 시 더미 폴백
        setLoading(false)
      }
    )

    return () => unsub()
  }, [])

  return { shows, loading, error }
}

// ─────────────────────────────────────────────
// useShow — 단일 공연 상세 훅
// ─────────────────────────────────────────────
import { doc, getDoc } from 'firebase/firestore'

export function useShow(showId) {
  const [show, setShow]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!showId) return

    // 더미 모드
    if (!isFirebaseConfigured || !db) {
      const found = sampleShows.find(s => s.id === showId)
      setShow(found ?? null)
      setLoading(false)
      return
    }

    // Firestore에서 문서 1개 조회
    getDoc(doc(db, 'shows', showId)).then(snap => {
      if (snap.exists()) {
        setShow({ id: snap.id, ...snap.data() })
      } else {
        // Firestore에 없으면 더미에서 탐색
        const found = sampleShows.find(s => s.id === showId)
        setShow(found ?? null)
      }
      setLoading(false)
    }).catch(err => {
      console.error(err)
      setLoading(false)
    })
  }, [showId])

  return { show, loading }
}
