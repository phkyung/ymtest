// ─────────────────────────────────────────────
// HomePage.jsx — 공연 목록 + 오늘 공연 필터
// ─────────────────────────────────────────────

import { useState, useMemo, useEffect } from 'react'
import { useShows } from '../hooks/useShows'
import ShowCard from '../components/ShowCard'
import { db, isFirebaseConfigured } from '../firebase'
import { collection, getDocs } from 'firebase/firestore'

// 오늘 공연 여부 판단
function isPlayingToday(startDate, endDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(startDate) <= today && today <= new Date(endDate)
}

const GENRE_OPTIONS = ['전체', '뮤지컬', '연극', '오페라']

export default function HomePage() {
  const { shows, loading } = useShows()
  const [filter, setFilter]     = useState('전체')   // 장르 필터
  const [todayOnly, setTodayOnly] = useState(false)  // 오늘 공연만

  // ── 임시 디버그: shows 컬렉션 문서 ID vs data.id 비교 ──
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return
    getDocs(collection(db, 'shows')).then(snap => {
      console.group('[DEBUG] shows 컬렉션 문서 ID 점검')
      snap.docs.forEach(d => {
        const docId  = d.id
        const dataId = d.data().id
        const match  = docId === dataId
        console.log(
          match ? '✅' : '❌ 불일치',
          `doc.id="${docId}"`,
          `data.id="${dataId ?? '(없음)'}"`
        )
      })
      console.groupEnd()
    })
  }, [])
  // ── 임시 디버그 끝 ──

  // 필터 적용
  const filtered = useMemo(() => {
    return shows.filter(s => {
      const genreOk = filter === '전체' || s.genre === filter
      const todayOk = !todayOnly || isPlayingToday(s.startDate, s.endDate)
      return genreOk && todayOk
    })
  }, [shows, filter, todayOnly])

  const todayCount = shows.filter(s => isPlayingToday(s.startDate, s.endDate)).length

  return (
    <div>
      {/* 헤더 */}
      <section className="mb-8">
        <h1 className="font-display text-3xl sm:text-4xl text-stone-900 leading-tight">
          서울 공연 아카이브
        </h1>
        <p className="text-stone-500 mt-2 text-sm sm:text-base">
          대학로 중심 · 연극·뮤지컬 정보와 배우 키워드
        </p>

        {/* Firebase 미연결 알림 */}
        {!isFirebaseConfigured && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2">
            <span>⚠️</span>
            <span>
              현재 <strong>더미 데이터</strong>로 실행 중입니다.
              Firebase 연결 후 실제 데이터를 사용하세요. (README 참고)
            </span>
          </div>
        )}
      </section>

      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* 장르 필터 */}
        <div className="flex gap-1.5">
          {GENRE_OPTIONS.map(g => (
            <button
              key={g}
              onClick={() => setFilter(g)}
              className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                filter === g
                  ? 'bg-stone-800 text-white'
                  : 'bg-white border border-stone-200 text-stone-600 hover:border-stone-400'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        {/* 오늘 공연 토글 */}
        <button
          onClick={() => setTodayOnly(!todayOnly)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border transition-all ${
            todayOnly
              ? 'bg-red-500 text-white border-red-500'
              : 'bg-white border-stone-200 text-stone-600 hover:border-red-300'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${todayOnly ? 'bg-red-200' : 'bg-red-400'}`} />
          오늘 공연 {todayCount > 0 && `(${todayCount})`}
        </button>

        {/* 결과 수 */}
        <span className="text-stone-400 text-sm ml-auto">
          총 {filtered.length}개 공연
        </span>
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="bg-white rounded-xl border border-stone-100 h-64 animate-pulse">
              <div className="h-36 bg-stone-100 rounded-t-xl" />
              <div className="p-4 space-y-2">
                <div className="h-4 bg-stone-100 rounded w-3/4" />
                <div className="h-3 bg-stone-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 공연 카드 그리드 */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-stone-400">
          <p className="text-4xl mb-3">🎭</p>
          <p className="font-display text-lg">해당 조건의 공연이 없습니다</p>
          <button
            onClick={() => { setFilter('전체'); setTodayOnly(false) }}
            className="mt-4 text-sm text-amber-600 underline"
          >
            필터 초기화
          </button>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(show => (
            <ShowCard key={show.id} show={show} />
          ))}
        </div>
      )}
    </div>
  )
}
