// ─────────────────────────────────────────────
// CastingBoard.jsx — 날짜별 캐스팅 보드
// ─────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import { db, isFirebaseConfigured } from '../firebase'
import { collection, query, where, getDocs } from 'firebase/firestore'

// ── 날짜 유틸 ─────────────────────────────────
const DAYS_KO  = ['일', '월', '화', '수', '목', '금', '토']

function toDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDateStr(str) {
  // "YYYY-MM-DD" → local Date (시간 0시)
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDisplay(dateStr) {
  const d   = parseDateStr(dateStr)
  const dow = DAYS_KO[d.getDay()]
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${dow})`
}

const TODAY = toDateStr(new Date())

// ── castingEvents 로드 ────────────────────────
// { "YYYY-MM-DD": ["이벤트명1", "이벤트명2"] }
function useCastingEvents() {
  const [eventMap, setEventMap] = useState({})
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return
    getDocs(collection(db, 'castingEvents')).then(snap => {
      const map = {}
      snap.docs.forEach(d => {
        const { date, events } = d.data()
        if (date && Array.isArray(events)) {
          map[date] = events.map(e => e.label).filter(Boolean)
        }
      })
      setEventMap(map)
    })
  }, [])
  return eventMap
}

// ── 달력 컴포넌트 ─────────────────────────────
function Calendar({ selected, onSelect, onClose, eventMap = {} }) {
  const today     = new Date()
  const selDate   = parseDateStr(selected)
  const [year,  setYear]  = useState(selDate.getFullYear())
  const [month, setMonth] = useState(selDate.getMonth())  // 0-indexed

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  // 해당 월의 달력 그리드 생성
  const firstDay  = new Date(year, month, 1).getDay()   // 0=일
  const daysInMon = new Date(year, month + 1, 0).getDate()

  // 앞 빈 칸 + 날짜 셀
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMon; d++) cells.push(d)

  return (
    <div className="absolute top-full left-0 mt-2 z-50 bg-white rounded-2xl shadow-xl border border-[#E8E4DF] p-4 w-72">
      {/* 월 이동 */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prevMonth}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-stone-100 text-[#6B5E52] transition-colors"
        >‹</button>
        <span className="text-sm font-semibold text-[#2C1810]">
          {year}년 {month + 1}월
        </span>
        <button
          onClick={nextMonth}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-stone-100 text-[#6B5E52] transition-colors"
        >›</button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS_KO.map((d, i) => (
          <div
            key={d}
            className={`text-center text-xs py-1 font-medium
              ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-stone-400'}`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* 날짜 셀 */}
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, idx) => {
          if (!day) return <div key={`e${idx}`} />
          const dateStr    = toDateStr(new Date(year, month, day))
          const isSel      = dateStr === selected
          const isToday    = dateStr === TODAY
          const dow        = (firstDay + day - 1) % 7
          const dayEvents  = eventMap[dateStr] ?? []
          return (
            <div key={day} className="flex flex-col items-center">
              <button
                onClick={() => { onSelect(dateStr); onClose() }}
                className={`h-8 w-8 flex items-center justify-center rounded-full text-xs transition-colors
                  ${isSel
                    ? 'bg-[#8FAF94] text-white font-bold'
                    : isToday
                      ? 'border border-[#8FAF94] text-[#8FAF94] font-semibold'
                      : dow === 0
                        ? 'text-red-400 hover:bg-stone-100'
                        : dow === 6
                          ? 'text-blue-400 hover:bg-stone-100'
                          : 'text-[#2C1810] hover:bg-stone-100'
                  }`}
              >
                {day}
              </button>
              {/* 이벤트 뱃지 */}
              {dayEvents.slice(0, 1).map((ev, i) => (
                <span
                  key={i}
                  className="mt-0.5 text-[9px] leading-tight px-1 py-0.5 rounded
                             bg-[#8FAF94]/20 text-[#2C1810] max-w-[36px] truncate text-center"
                  title={ev}
                >
                  {ev}
                </span>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 장르 뱃지 ─────────────────────────────────
const GENRE_COLORS = {
  뮤지컬: 'bg-[#D4E6D7] text-[#2C5F35]',
  연극:   'bg-[#E6DDD4] text-[#5F3E2C]',
  오페라: 'bg-[#D4D9E6] text-[#2C3A5F]',
  콘서트: 'bg-[#E6D4D9] text-[#5F2C3A]',
}
function genreBadgeClass(genre) {
  return GENRE_COLORS[genre] ?? 'bg-stone-100 text-stone-500'
}

// ── 메인 ──────────────────────────────────────
export default function CastingBoard() {
  const [selected,     setSelected]     = useState(TODAY)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [casts,        setCasts]        = useState([])
  const [loading,      setLoading]      = useState(false)
  const eventMap   = useCastingEvents()
  const wrapperRef = useRef(null)

  // 달력 외부 클릭 시 닫기
  useEffect(() => {
    if (!calendarOpen) return
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setCalendarOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [calendarOpen])

  // 선택 날짜 변경 시 데이터 로드
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return
    setLoading(true)
    setCasts([])
    const q = query(collection(db, 'dailyCasts'), where('date', '==', selected))
    getDocs(q)
      .then(snap => {
        const items = snap.docs.map(d => d.data())
        items.sort((a, b) => (a.showTitle ?? '').localeCompare(b.showTitle ?? '', 'ko') || (a.time ?? '').localeCompare(b.time ?? ''))
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

        {/* 날짜 선택 (달력 팝업) */}
        <div className="relative mb-8 inline-block" ref={wrapperRef}>
          <button
            onClick={() => setCalendarOpen(o => !o)}
            className="flex items-center gap-2 px-5 py-2.5 bg-white rounded-xl border border-[#E8E4DF]
                       hover:border-[#8FAF94] transition-colors text-sm font-medium text-[#2C1810] shadow-sm"
          >
            <span>📅</span>
            <span>{formatDisplay(selected)}</span>
            <span className="text-stone-300 text-xs ml-1">▾</span>
          </button>

          {calendarOpen && (
            <Calendar
              selected={selected}
              onSelect={setSelected}
              onClose={() => setCalendarOpen(false)}
              eventMap={eventMap}
            />
          )}
        </div>

        {/* 선택 날짜 이벤트 뱃지 */}
        {(eventMap[selected] ?? []).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {(eventMap[selected]).map((ev, i) => (
              <span
                key={i}
                className="px-3 py-1 rounded-full text-xs font-medium bg-[#8FAF94]/20 text-[#2C1810] border border-[#8FAF94]/30"
              >
                🎪 {ev}
              </span>
            ))}
          </div>
        )}

        {/* 캐스팅 카드 목록 */}
        {loading ? (
          <p className="text-center text-stone-400 py-20 text-sm">불러오는 중...</p>
        ) : casts.length === 0 ? (
          <p className="text-center text-stone-400 py-20 text-sm leading-relaxed">
            아직 등록된 캐스팅 정보가 없어요.<br />
            곧 채워질 예정입니다 🎭
          </p>
        ) : (() => {
          // 같은 공연이 여러 회차(시간)를 가질 수 있으므로 showTitle로 그룹핑
          const byShow = {}
          casts.forEach(cast => {
            const title = cast.showTitle ?? '(제목 없음)'
            if (!byShow[title]) byShow[title] = { genre: cast.genre, sessions: [] }
            byShow[title].sessions.push(cast)
          })
          // 각 공연 내 세션을 시간 순 정렬
          Object.values(byShow).forEach(g => g.sessions.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')))

          function timeLabel(t) {
            if (!t) return ''
            const hour = parseInt(t.split(':')[0])
            if (hour < 17) return `낮공연(${t})`
            return `밤공연(${t})`
          }

          return (
            <div className="flex flex-col gap-4">
              {Object.entries(byShow).map(([title, { genre, sessions }]) => {
                const hasMultiple = sessions.length > 1 || sessions.some(s => s.time)
                return (
                  <div
                    key={title}
                    className="bg-white rounded-2xl border border-[#E8E4DF] px-6 py-5 shadow-sm"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span className="font-semibold text-[#2C1810] text-base leading-tight">
                        {title}
                      </span>
                      {genre && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${genreBadgeClass(genre)}`}>
                          {genre}
                        </span>
                      )}
                    </div>
                    {sessions.map((cast, si) => (
                      <div key={si} className={si > 0 ? 'mt-3 pt-3 border-t border-[#E8E4DF]' : ''}>
                        {hasMultiple && cast.time && (
                          <p className="text-xs font-semibold text-[#8FAF94] mb-2">
                            🕐 {timeLabel(cast.time)}
                          </p>
                        )}
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
                )
              })}
            </div>
          )
        })()}

      </div>
    </div>
  )
}
