// ─────────────────────────────────────────────
// ActorPage.jsx — 배우 상세 + 출연 이력 + 키워드 집계
// ─────────────────────────────────────────────

import { useParams, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useActor } from '../hooks/useActor'
import { toHttps } from '../utils/imageUrl'
import CommentSection from '../components/CommentSection'
import { db, isFirebaseConfigured } from '../firebase'
import { collection, query, where, getDocs } from 'firebase/firestore'

// ── 배우별 키워드 투표 전체 집계 ──────────────────
function useActorKeywords(actorId) {
  const [keywords, setKeywords] = useState([])

  useEffect(() => {
    if (!actorId || !isFirebaseConfigured || !db) {
      setKeywords([
        { keyword: '카리스마', count: 42 },
        { keyword: '압도적',   count: 35 },
        { keyword: '섬세함',   count: 28 },
        { keyword: '냉혹함',   count: 21 },
        { keyword: '절제',     count: 14 },
      ])
      return
    }

    const q = query(collection(db, 'votes'), where('actorId', '==', actorId))
    getDocs(q).then(snap => {
      const tally = {}
      snap.docs.forEach(d => {
        const { keyword, count } = d.data()
        tally[keyword] = (tally[keyword] ?? 0) + (count ?? 0)
      })
      const sorted = Object.entries(tally)
        .map(([keyword, count]) => ({ keyword, count }))
        .sort((a, b) => b.count - a.count)
      setKeywords(sorted)
    })
  }, [actorId])

  return keywords
}

// ── 키워드 막대 ───────────────────────────────────
function KeywordBar({ keyword, count, max }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-[#6B5E52] w-24 shrink-0 text-right">{keyword}</span>
      <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#8FAF94] rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-stone-400 w-8 shrink-0 text-right">{count}</span>
    </div>
  )
}

// ── 공연 이력 카드 ────────────────────────────────
function ShowItem({ show, actorId }) {
  const role = show.cast?.find(c => c.actorId === actorId || c.actorName === show._matchedName)
  const genreColor = {
    '뮤지컬': 'bg-amber-50 text-amber-700',
    '연극':   'bg-sky-50 text-sky-700',
    '오페라': 'bg-purple-50 text-purple-700',
  }[show.genre] ?? 'bg-stone-100 text-stone-600'

  return (
    <Link
      to={`/shows/${show.id}`}
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-stone-100
                 bg-white hover:bg-[#FAF8F5] hover:border-[#C8D8CA] transition-all group"
    >
      {/* 포스터 썸네일 */}
      <div className="w-8 h-11 rounded-md overflow-hidden bg-stone-100 shrink-0">
        {show.posterUrl ? (
          <img
            src={toHttps(show.posterUrl)}
            alt={show.title}
            className="w-full h-full object-cover"
            onError={e => { e.target.style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-base">🎭</div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${genreColor}`}>
            {show.genre}
          </span>
          <p className="font-medium text-[#2C1810] text-sm truncate group-hover:text-[#4A6B4F] transition-colors">
            {show.title}
          </p>
        </div>
        {role?.roleName && (
          <p className="text-xs text-stone-400">
            {role.roleName} 역{role.isDouble ? ' · 더블캐스트' : ''}
          </p>
        )}
      </div>

      <div className="text-right shrink-0">
        <p className="text-xs text-stone-400">{show.venue}</p>
        <p className="text-xs text-stone-300 mt-0.5">{show.startDate?.slice(0, 7)}</p>
      </div>
    </Link>
  )
}

// ── 필모그라피 장르 뱃지 ──────────────────────────
const FILM_GENRE_COLOR = {
  '뮤지컬': 'bg-amber-50 text-amber-700',
  '연극':   'bg-sky-50 text-sky-700',
  '음악극': 'bg-teal-50 text-teal-700',
}
function filmGenreBadge(genre) {
  return FILM_GENRE_COLOR[genre] ?? 'bg-stone-100 text-stone-500'
}

// ── 필모그라피 섹션 ───────────────────────────────
function FilmographySection({ filmography, showTitleMap }) {
  if (!filmography || filmography.length === 0) {
    return (
      <section className="bg-white border border-stone-100 rounded-2xl p-5">
        <h2 className="font-display text-lg text-[#2C1810] mb-3">필모그라피</h2>
        <p className="text-sm text-stone-400 text-center py-4">아직 필모그라피 정보가 없어요</p>
      </section>
    )
  }

  const sorted = [...filmography].sort((a, b) => {
    const ya = a.year ?? ''
    const yb = b.year ?? ''
    return yb.localeCompare(ya)
  })

  return (
    <section className="bg-white border border-stone-100 rounded-2xl p-5">
      <h2 className="font-display text-lg text-[#2C1810] mb-3">
        필모그라피
        <span className="ml-2 text-sm font-body text-stone-400 font-normal">({sorted.length}편)</span>
      </h2>
      <ul className="space-y-2">
        {sorted.map((item, idx) => {
          const showId = item.title ? showTitleMap[item.title] : null
          const inner = (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-stone-100
                            bg-[#FAF8F5] hover:border-[#C8D8CA] transition-all">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${filmGenreBadge(item.genre)}`}>
                {item.genre ?? '기타'}
              </span>
              <span className="flex-1 text-sm font-medium text-[#2C1810] truncate">
                {item.title}
              </span>
              {item.year && (
                <span className="text-xs text-stone-400 shrink-0">{item.year}</span>
              )}
              {showId && (
                <span className="text-xs text-[#8FAF94] shrink-0">›</span>
              )}
            </div>
          )
          return (
            <li key={idx}>
              {showId ? (
                <Link to={`/shows/${showId}`} className="block hover:opacity-90 transition-opacity">
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── 메인 페이지 ───────────────────────────────────
export default function ActorPage() {
  const { actorId } = useParams()
  const { actor, shows, loading } = useActor(actorId)
  const keywords = useActorKeywords(actorId)
  const [imgError, setImgError] = useState(false)

  // shows 타이틀 → showId 맵 (필모그라피 링크용)
  const showTitleMap = shows.reduce((acc, s) => {
    if (s.title) acc[s.title] = s.id
    return acc
  }, {})

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 max-w-2xl mx-auto">
        <div className="h-5 bg-stone-100 rounded w-20" />
        <div className="flex gap-5">
          <div className="w-24 h-24 bg-stone-100 rounded-2xl shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-7 bg-stone-100 rounded w-32" />
            <div className="h-4 bg-stone-100 rounded w-48" />
            <div className="h-4 bg-stone-100 rounded w-40" />
          </div>
        </div>
      </div>
    )
  }

  if (!actor) {
    return (
      <div className="text-center py-20 text-stone-400">
        <p className="text-5xl mb-4">👤</p>
        <p className="font-display text-lg text-stone-600">배우 정보를 찾을 수 없습니다</p>
        <Link to="/" className="mt-4 inline-block text-sm text-[#8FAF94] underline hover:text-[#7A9E7F]">
          공연 목록으로
        </Link>
      </div>
    )
  }

  const hasPhoto = actor.imageUrl && !imgError

  return (
    <div className="max-w-2xl mx-auto space-y-8">

      {/* 뒤로가기 */}
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-stone-400 text-sm hover:text-stone-600 transition-colors"
      >
        ← 공연 목록
      </Link>

      {/* ── 배우 헤더 ── */}
      <section className="flex items-start gap-5">
        {/* 사진 또는 이니셜 아바타 */}
        {hasPhoto ? (
          <img
            src={toHttps(actor.imageUrl)}
            alt={actor.name}
            onError={() => setImgError(true)}
            className="w-24 h-24 rounded-2xl object-cover shrink-0 border border-stone-100 shadow-sm"
          />
        ) : (
          <div className="w-24 h-24 rounded-2xl bg-[#2C1810] text-white flex items-center
                          justify-center font-display text-3xl shrink-0 shadow-sm">
            {actor.name?.[0] ?? '?'}
          </div>
        )}

        {/* 이름 + 소속사 + bio */}
        <div className="flex-1 min-w-0 pt-1">
          <h1 className="font-display text-3xl text-[#2C1810] leading-tight">{actor.name}</h1>

          {/* 소속사 */}
          {actor.agency && (
            <p className="text-sm text-[#8FAF94] font-medium mt-1">{actor.agency}</p>
          )}

          {/* bio */}
          {actor.bio && (
            <p className="text-stone-500 text-sm mt-2 leading-relaxed">{actor.bio}</p>
          )}

          {/* 출연작 수 배지 */}
          {shows.length > 0 && (
            <span className="inline-block mt-3 text-xs bg-[#EEF5EF] text-[#4A6B4F]
                             px-2.5 py-1 rounded-full font-medium">
              출연작 {shows.length}편
            </span>
          )}
        </div>
      </section>

      {/* ── 키워드 분포 ── */}
      {keywords.length > 0 && (
        <section className="bg-white border border-stone-100 rounded-2xl p-5">
          <h2 className="font-display text-lg text-[#2C1810] mb-0.5">
            키워드 분포
          </h2>
          <p className="text-xs text-stone-400 mb-5">
            관객이 투표한 키워드를 전체 공연에서 집계한 결과
          </p>
          <div className="space-y-3">
            {keywords.slice(0, 8).map(kw => (
              <KeywordBar
                key={kw.keyword}
                keyword={kw.keyword}
                count={kw.count}
                max={keywords[0]?.count ?? 1}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── 필모그라피 ── */}
      <FilmographySection filmography={actor.filmography} showTitleMap={showTitleMap} />

      {/* ── 출연 이력 ── */}
      {shows.length > 0 ? (
        <section>
          <h2 className="font-display text-lg text-[#2C1810] mb-3">
            출연 이력
            <span className="ml-2 text-sm font-body text-stone-400 font-normal">
              ({shows.length}편)
            </span>
          </h2>
          <ul className="space-y-2">
            {shows.map(show => (
              <li key={show.id}>
                <ShowItem show={show} actorId={actorId} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="text-center py-10 text-stone-300">
          <p className="text-3xl mb-2">🎭</p>
          <p className="text-sm text-stone-400">등록된 출연 이력이 없습니다</p>
        </section>
      )}

      {/* ── 댓글 ── */}
      <section className="bg-white border border-stone-100 rounded-2xl p-5">
        <CommentSection targetId={actorId} targetType="actor" />
      </section>

    </div>
  )
}
