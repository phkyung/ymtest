// ─────────────────────────────────────────────
// useShows.js — 공연 목록 데이터 훅
// ─────────────────────────────────────────────
// Firebase 연결 시 → Firestore에서 실시간 로드
// Firebase 미연결 시 → sampleShows.json 더미 사용
// ─────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { collection, onSnapshot, orderBy, query, where, getDocs } from 'firebase/firestore'
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
        // d.id(문서 ID)를 마지막에 두어 data.id 필드보다 항상 우선
        const data = snap.docs
          .map(d => ({ ...d.data(), id: d.id }))
          .filter(s => s.status !== 'rejected')
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

    console.debug('[useShow] 조회 시작 — URL showId:', showId)

    getDoc(doc(db, 'shows', showId)).then(async snap => {
      if (snap.exists()) {
        // 1차: 문서 ID로 바로 찾은 경우
        console.debug('[useShow] 문서 ID로 찾음 — doc.id:', snap.id)
        const data = { ...snap.data(), id: snap.id }
        setShow(data.status === 'rejected' ? null : data)
      } else {
        // 2차: 문서 ID로 못 찾은 경우 → id 필드 값으로 쿼리
        console.debug('[useShow] 문서 ID로 못 찾음. id 필드 쿼리 시도 — id:', showId)
        const q      = query(collection(db, 'shows'), where('id', '==', showId))
        const result = await getDocs(q)

        if (!result.empty) {
          const d    = result.docs[0]
          const data = { ...d.data(), id: d.id }
          console.debug('[useShow] id 필드로 찾음 — 실제 doc.id:', d.id, '/ data.id:', d.data().id)
          setShow(data.status === 'rejected' ? null : data)
        } else {
          // 3차: 더미 데이터에서 탐색
          console.debug('[useShow] Firestore에서 찾지 못함. 더미 탐색')
          const found = sampleShows.find(s => s.id === showId)
          setShow(found ?? null)
        }
      }
      setLoading(false)
    }).catch(err => {
      console.error('[useShow] 조회 오류:', err)
      setLoading(false)
    })
  }, [showId])

  return { show, loading }
}
