// ─────────────────────────────────────────────
// CastingBoard.jsx — 날짜별 캐스팅 보드
// ─────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { db, isFirebaseConfigured } from '../firebase'
import { collection, query, where, getDocs } from 'firebase/firestore'

// 날짜 → "YYYY-MM-DD" 문자열
function toDateStr(date) {
  return date.toISOString().slice(0, 10)
}

// "YYYY-MM-DD" → "M월 D일 (요일)"
function formatLabel(dateStr, isToday) {
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['일', '월', '화', '수', '목', '금', '토']
  const label = `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`
  return isToday ? `오늘 ${label}` : label
}

// 오늘 기준 ±3일 날짜 배열 생성
function buildDateRange() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dates = []
  for (let i = -3; i <= 3; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    dates.push(toDateStr(d))
  }
  return dates
}

const TODAY = toDateStr(new Date())

const GENRE_COLORS = {
  뮤지컬: 'bg-[#D4E6D7] text-[#2C5F35]',
  연극:   'bg-[#E6DDD4] text-[#5F3E2C]',
  오페라: 'bg-[#D4D9E6] text-[#2C3A5F]',
  콘서트: 'bg-[#E6D4D9] text-[#5F2C3A]',
}
function genreBadgeClass(genre) {
  return GENRE_COLORS[genre] ?? 'bg-stone-100 text-stone-500'
}

export default function CastingBoard() {
  const dates = buildDateRange()
  const [selected, setSelected] = useState(TODAY)
  const [casts, setCasts]       = useState([])   // [{ showId, showTitle, genre, entries: [{actorName, role}] }]
  const [loading, setLoading]   = useState(false)

  useEffect(() => {
    if (!isFirebaseConfigured || !db) return
    setLoading(true)
    setCasts([])

    const q = query(
      collection(db, 'dailyCasts'),
      where('date', '==', selected),
    )
    getDocs(q)
      .then(snap => {
        const items = snap.docs.map(d => d.data())
        // showTitle 기준 정렬
        items.sort((a, b) => (a.showTitle ?? '').localeCompare(b.showTitle ?? '', 'ko'))
        setCasts(items)
      })
      .finally(() => setLoading(false))
  }, [selected])

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#2C1810]">
      <div className="max-w-3xl mx-auto px-4 py-10">

        {/* 헤더 */}
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold mb-1">캐스팅 보드</h1>
          <p className="text-[#6B5E52] text-sm">오늘 무대에 누가 서나요?</p>
        </div>

        {/* 날짜 선택 */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-8 scrollbar-none">
          {dates.map(dateStr => {
            const isToday    = dateStr === TODAY
            const isSelected = dateStr === selected
            return (
              <button
                key={dateStr}
                onClick={() => setSelected(dateStr)}
                className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors
                  ${isSelected
                    ? 'bg-[#8FAF94] text-white shadow-sm'
                    : 'bg-white border border-[#E8E4DF] text-[#6B5E52] hover:border-[#8FAF94] hover:text-[#8FAF94]'
                  }`}
              >
                {formatLabel(dateStr, isToday)}
              </button>
            )
          })}
        </div>

        {/* 캐스팅 카드 목록 */}
        {loading ? (
          <p className="text-center text-stone-400 py-20 text-sm">불러오는 중...</p>
        ) : casts.length === 0 ? (
          <p className="text-center text-stone-400 py-20 text-sm leading-relaxed">
            아직 등록된 캐스팅 정보가 없어요.<br />
            곧 채워질 예정입니다 🎭
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {casts.map((cast, i) => (
              <div
                key={cast.showId ?? i}
                className="bg-white rounded-2xl border border-[#E8E4DF] px-6 py-5 shadow-sm"
              >
                {/* 공연 제목 + 장르 */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-semibold text-[#2C1810] text-base leading-tight">
                    {cast.showTitle ?? '(제목 없음)'}
                  </span>
                  {cast.genre && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${genreBadgeClass(cast.genre)}`}>
                      {cast.genre}
                    </span>
                  )}
                </div>

                {/* 배우 목록 */}
                <ul className="flex flex-col gap-1.5">
                  {(cast.entries ?? []).map((entry, j) => (
                    <li key={j} className="flex items-baseline gap-2 text-sm">
                      <span className="font-medium text-[#2C1810]">{entry.actorName}</span>
                      {entry.role && (
                        <>
                          <span className="text-stone-300">·</span>
                          <span className="text-[#6B5E52]">{entry.role}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
