// ─────────────────────────────────────────────
// ShowCard.jsx — 공연 목록 compact list 카드
// ─────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

// 장르별 색상 뱃지
const GENRE_COLOR = {
  '뮤지컬': 'bg-amber-100 text-amber-800',
  '연극':   'bg-sky-100 text-sky-800',
  '오페라': 'bg-purple-100 text-purple-800',
  '콘서트': 'bg-pink-100 text-pink-800',
  '무용':   'bg-teal-100 text-teal-800',
}

// 날짜를 "6.10" 형식으로 변환
function formatDateShort(dateStr) {
  if (!dateStr) return ''
  const [, m, d] = dateStr.split('-')
  return `${parseInt(m)}.${parseInt(d)}`
}

// 오늘 공연 여부 판단
function isPlayingToday(startDate, endDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(startDate) <= today && today <= new Date(endDate)
}

// 오늘 캐스트 팝업
function CastPopup({ cast, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute z-50 right-0 top-8 w-64 bg-white border border-stone-200 rounded-xl shadow-lg p-3"
      onClick={e => e.preventDefault()}
    >
      <p className="text-xs font-semibold text-stone-500 mb-2">오늘 캐스트</p>
      {!cast || cast.length === 0 ? (
        <p className="text-xs text-stone-400 py-2 text-center">캐스트 정보 없음</p>
      ) : (
        <ul className="space-y-2">
          {cast.map((c, i) => (
            <li key={i} className="flex items-center gap-2">
              {c.imageUrl ? (
                <img
                  src={c.imageUrl}
                  alt={c.actorName}
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs text-stone-400">
                    {c.actorName?.[0] ?? '?'}
                  </span>
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-800 truncate">{c.actorName}</p>
                {c.roleName && (
                  <p className="text-xs text-stone-400 truncate">
                    {c.roleName}{c.isDouble ? ' (더블캐스트)' : ''}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ShowCard({ show }) {
  const playing = isPlayingToday(show.startDate, show.endDate)
  const [castOpen, setCastOpen] = useState(false)

  return (
    <li className="relative">
      <Link
        to={`/shows/${show.id}`}
        className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-all group
          ${playing
            ? 'border-l-4 border-l-red-400 border-t-stone-100 border-r-stone-100 border-b-stone-100 bg-red-50/30 hover:bg-red-50/60'
            : 'border-stone-100 bg-white hover:bg-stone-50'
          }`}
      >
        {/* 장르 뱃지 */}
        <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap
          ${GENRE_COLOR[show.genre] ?? 'bg-stone-100 text-stone-600'}`}>
          {show.genre}
        </span>

        {/* 제목 + 공연장 */}
        <div className="flex-1 min-w-0">
          <span className="font-medium text-stone-900 text-sm group-hover:text-amber-700 transition-colors truncate block">
            {show.title}
          </span>
          <span className="text-xs text-stone-400 truncate block sm:hidden">
            {show.venue} · {formatDateShort(show.startDate)}~{formatDateShort(show.endDate)}
          </span>
        </div>

        {/* 공연장 + 날짜 (데스크탑) */}
        <span className="hidden sm:block text-xs text-stone-400 flex-shrink-0 whitespace-nowrap">
          {show.venue}
        </span>
        <span className="hidden sm:block text-xs text-stone-300 flex-shrink-0 whitespace-nowrap">
          {formatDateShort(show.startDate)}~{formatDateShort(show.endDate)}
        </span>

        {/* 오늘 공연 뱃지 */}
        {playing && (
          <span className="flex-shrink-0 text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-medium animate-pulse">
            오늘
          </span>
        )}
      </Link>

      {/* 오늘 캐스트 버튼 (오늘 공연만 표시) */}
      {playing && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
          <button
            onClick={e => { e.preventDefault(); setCastOpen(v => !v) }}
            className="text-xs text-red-500 hover:text-red-700 bg-white border border-red-200 hover:border-red-400 px-2 py-0.5 rounded-full transition-colors ml-1"
          >
            캐스트
          </button>
          {castOpen && (
            <CastPopup cast={show.cast} onClose={() => setCastOpen(false)} />
          )}
        </div>
      )}
    </li>
  )
}
