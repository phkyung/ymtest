// ─────────────────────────────────────────────
// ShowCard.jsx — 공연 목록에서 쓰이는 카드 컴포넌트
// ─────────────────────────────────────────────

import { Link } from 'react-router-dom'

// 장르별 색상 뱃지
const GENRE_COLOR = {
  '뮤지컬': 'bg-amber-100 text-amber-800',
  '연극':   'bg-sky-100 text-sky-800',
  '오페라': 'bg-purple-100 text-purple-800',
}

// 날짜를 "6월 10일" 형식으로 변환
function formatDate(dateStr) {
  if (!dateStr) return ''
  const [, m, d] = dateStr.split('-')
  return `${parseInt(m)}월 ${parseInt(d)}일`
}

// 오늘 공연 여부 판단
function isPlayingToday(startDate, endDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(startDate)
  const end   = new Date(endDate)
  return start <= today && today <= end
}

export default function ShowCard({ show }) {
  const playing = isPlayingToday(show.startDate, show.endDate)

  // show.id = Firestore 문서 ID (useShows에서 d.id 우선으로 보장)
  return (
    <Link
      to={`/shows/${show.id}`}
      className="block group"
    >
      <article className="bg-white rounded-xl border border-stone-100 overflow-hidden card-hover">
        {/* 이미지 영역 — 이미지 없을 때 플레이스홀더 */}
        <div className="h-36 bg-gradient-to-br from-stone-800 to-stone-600 relative overflow-hidden">
          {show.imageUrl ? (
            <img
              src={show.imageUrl}
              alt={show.title}
              className="w-full h-full object-cover opacity-80"
            />
          ) : (
            <div className="absolute inset-0 flex items-end p-4">
              <span className="font-display text-white text-xl leading-tight opacity-70">
                {show.title}
              </span>
            </div>
          )}

          {/* 오늘 공연 뱃지 */}
          {playing && (
            <span className="absolute top-3 right-3 bg-red-500 text-white text-xs px-2 py-1 rounded-full font-medium animate-pulse">
              오늘 공연
            </span>
          )}

          {/* 장르 뱃지 */}
          <span className={`absolute top-3 left-3 text-xs px-2 py-1 rounded-full font-medium ${GENRE_COLOR[show.genre] ?? 'bg-stone-100 text-stone-700'}`}>
            {show.genre}
          </span>
        </div>

        {/* 텍스트 영역 */}
        <div className="p-4">
          <h3 className="font-display text-stone-900 text-lg leading-tight group-hover:text-amber-700 transition-colors">
            {show.title}
          </h3>
          {show.subtitle && (
            <p className="text-stone-400 text-xs mt-0.5 italic">{show.subtitle}</p>
          )}

          <p className="text-stone-500 text-sm mt-2 flex items-start gap-1">
            <span>📍</span>
            <span>{show.venue}</span>
          </p>

          <p className="text-stone-400 text-xs mt-1">
            {formatDate(show.startDate)} ~ {formatDate(show.endDate)}
            {show.runtime && (
              <span className="ml-2 text-stone-300">· {show.runtime}분</span>
            )}
          </p>

          {/* 태그 */}
          {show.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {show.tags.slice(0, 3).map(tag => (
                <span
                  key={tag}
                  className="text-xs bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </article>
    </Link>
  )
}
