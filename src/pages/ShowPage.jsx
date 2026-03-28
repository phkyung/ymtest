// ─────────────────────────────────────────────
// ShowPage.jsx — 공연 상세 페이지
// ─────────────────────────────────────────────

import { useParams, Link } from 'react-router-dom'
import { useShow } from '../hooks/useShows'
import KeywordVote from '../components/KeywordVote'
import CommentSection from '../components/CommentSection'

function formatDateRange(start, end) {
  if (!start) return ''
  const s = new Date(start)
  const e = new Date(end)
  const fmt = d => `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`
  return `${fmt(s)} ~ ${fmt(e)}`
}

export default function ShowPage() {
  const { showId } = useParams()
  const { show, loading } = useShow(showId)

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-stone-100 rounded w-1/2" />
        <div className="h-48 bg-stone-100 rounded-xl" />
      </div>
    )
  }

  if (!show) {
    return (
      <div className="text-center py-16 text-stone-400">
        <p className="text-4xl mb-3">🎭</p>
        <p className="font-display text-lg">공연을 찾을 수 없습니다</p>
        <Link to="/" className="mt-4 inline-block text-sm text-amber-600 underline">
          목록으로
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-10">

      {/* 뒤로가기 */}
      <Link to="/" className="inline-flex items-center gap-1 text-stone-400 text-sm hover:text-stone-700 transition-colors">
        ← 공연 목록
      </Link>

      {/* 공연 헤더 */}
      <section className="bg-gradient-to-br from-stone-800 to-stone-900 rounded-2xl p-6 sm:p-8 text-white">
        {/* 장르 뱃지 */}
        <span className="inline-block text-xs bg-white/10 border border-white/20 px-2 py-1 rounded-full mb-3">
          {show.genre}
        </span>

        <h1 className="font-display text-3xl sm:text-4xl leading-tight">
          {show.title}
        </h1>
        {show.subtitle && (
          <p className="text-stone-400 italic mt-1 text-sm">{show.subtitle}</p>
        )}

        <div className="mt-5 grid sm:grid-cols-2 gap-3 text-sm text-stone-300">
          <div className="flex items-start gap-2">
            <span>📍</span>
            <div>
              <p className="text-white font-medium">{show.venue}</p>
              {show.address && <p className="text-stone-400 text-xs mt-0.5">{show.address}</p>}
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span>🗓</span>
            <div>
              <p className="text-white">{formatDateRange(show.startDate, show.endDate)}</p>
              {show.runtime && (
                <p className="text-stone-400 text-xs mt-0.5">
                  상연 시간 {show.runtime}분
                  {show.intermission > 0 && ` (인터미션 포함)`}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 태그 */}
        {show.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-5">
            {show.tags.map(t => (
              <span key={t} className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-stone-300">
                #{t}
              </span>
            ))}
          </div>
        )}

        {/* 티켓 링크 */}
        {show.ticketUrl && (
          <a
            href={show.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-block px-4 py-2 bg-amber-500 hover:bg-amber-400
                       text-stone-900 text-sm font-medium rounded-lg transition-colors"
          >
            티켓 예매 →
          </a>
        )}
      </section>

      {/* 시놉시스 */}
      {show.synopsis && (
        <section>
          <h2 className="font-display text-xl text-stone-800 mb-3">작품 소개</h2>
          <p className="text-stone-600 leading-relaxed text-sm sm:text-base">
            {show.synopsis}
          </p>
        </section>
      )}

      {/* 출연진 + 키워드 투표 */}
      {show.cast?.length > 0 && (
        <section>
          <h2 className="font-display text-xl text-stone-800 mb-4">출연진</h2>

          <div className="space-y-8">
            {show.cast.map((castMember, idx) => (
              <div key={idx} className="bg-white border border-stone-100 rounded-xl p-5 space-y-4">

                {/* 배우 정보 행 */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link
                      to={`/actors/${castMember.actorId}`}
                      className="font-display text-lg text-stone-800 hover:text-amber-700 transition-colors"
                    >
                      {castMember.actorName}
                    </Link>
                    <p className="text-stone-400 text-sm mt-0.5">
                      {castMember.roleName} 역
                      {castMember.isDouble && (
                        <span className="ml-2 text-xs bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">
                          더블캐스팅
                        </span>
                      )}
                    </p>
                  </div>

                  <Link
                    to={`/actors/${castMember.actorId}`}
                    className="text-xs text-amber-600 hover:text-amber-700 border border-amber-200 px-2 py-1 rounded-lg shrink-0"
                  >
                    배우 페이지 →
                  </Link>
                </div>

                {/* 구분선 */}
                <div className="border-t border-stone-100" />

                {/* 키워드 투표 */}
                <KeywordVote
                  showId={show.id}
                  actorId={castMember.actorId}
                  roleName={castMember.roleName}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 댓글 */}
      <section className="bg-white border border-stone-100 rounded-xl p-5">
        <CommentSection targetId={show.id} targetType="show" />
      </section>

    </div>
  )
}
