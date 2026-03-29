// ─────────────────────────────────────────────
// ShowPage.jsx — 공연 상세 페이지
// ─────────────────────────────────────────────

import { useParams, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useShow } from '../hooks/useShows'
import { toHttps } from '../utils/imageUrl'
import KeywordVote from '../components/KeywordVote'
import CommentSection from '../components/CommentSection'
import { db, isFirebaseConfigured } from '../firebase'
import { collection, getDocs } from 'firebase/firestore'

function formatDateRange(start, end) {
  if (!start) return ''
  const s = new Date(start)
  const e = new Date(end)
  const fmt = d => `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`
  return `${fmt(s)} ~ ${fmt(e)}`
}

// ── 출연진 섹션: 역할별 그룹핑 + 배우 선택 → 키워드 투표 ──
function CastSection({ cast, showId, actorIdMap }) {
  // cast 아이템에 resolvedId 미리 계산
  const enriched = cast.map(m => ({
    ...m,
    resolvedId: actorIdMap[m.actorName] || m.actorId || null,
  }))

  // 역할별 그룹핑 (역할명 없으면 "출연")
  const groups = []
  const groupMap = {}
  enriched.forEach(m => {
    const role = m.roleName?.trim() || '출연'
    if (!groupMap[role]) {
      groupMap[role] = []
      groups.push(role)
    }
    groupMap[role].push(m)
  })

  // 선택된 배우: { actorName, resolvedId, roleName }
  const [selected, setSelected] = useState(enriched[0] ?? null)

  return (
    <section>
      <h2 className="font-display text-xl text-stone-800 mb-4">출연진</h2>

      <div className="bg-white border border-stone-100 rounded-xl p-5 space-y-5">
        {/* 역할 그룹별 배우 버튼 */}
        {groups.map(role => (
          <div key={role}>
            <p className="text-sm font-semibold text-[#6B5E52] border-b border-[#E8E4DF] pb-1 mb-3">
              {role}
            </p>
            <div className="flex flex-wrap gap-2">
              {groupMap[role].map((m, idx) => {
                const isSelected = selected?.actorName === m.actorName && selected?.roleName === m.roleName
                return (
                  <button
                    key={idx}
                    onClick={() => setSelected(m)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      isSelected
                        ? 'bg-[#8FAF94] text-white'
                        : 'border border-[#C8D8CA] text-[#4A6B4F] hover:bg-[#8FAF94] hover:text-white'
                    }`}
                  >
                    {m.actorName}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* 선택된 배우 + 키워드 투표 */}
        {selected && (
          <>
            <div className="border-t border-stone-100 pt-4">
              <div className="flex items-center gap-2 mb-4">
                <span className="font-display text-base text-stone-800 font-semibold">
                  {selected.actorName}
                </span>
                {selected.roleName?.trim() && (
                  <span className="text-sm text-stone-400">{selected.roleName} 역</span>
                )}
                {selected.resolvedId && (
                  <Link
                    to={`/actors/${selected.resolvedId}`}
                    className="ml-auto text-xs bg-[#8FAF94] hover:bg-[#7A9E7F] text-white px-2 py-1 rounded-lg shrink-0 transition-colors"
                  >
                    배우 페이지 →
                  </Link>
                )}
              </div>
              <KeywordVote
                showId={showId}
                actorId={selected.resolvedId}
                roleName={selected.roleName}
              />
            </div>
          </>
        )}
      </div>
    </section>
  )
}

export default function ShowPage() {
  const { showId } = useParams()
  const { show, loading } = useShow(showId)

  // 배우 이름 → actorId 매핑 (actors 컬렉션에 등록된 배우만)
  const [actorIdMap, setActorIdMap] = useState({})

  useEffect(() => {
    if (!show?.cast?.length || !isFirebaseConfigured || !db) return
    getDocs(collection(db, 'actors')).then(snap => {
      const map = {}
      snap.docs.forEach(d => {
        const name = d.data().name
        if (name) map[name] = d.id
      })
      setActorIdMap(map)
    }).catch(err => console.error('배우 ID 조회 오류:', err))
  }, [show])

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
      <section className="relative rounded-2xl overflow-hidden text-white bg-[#7A5C48]">
        {/* 포스터 배경 이미지 */}
        {show.posterUrl && (
          <img
            src={toHttps(show.posterUrl)}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        {/* 어두운 오버레이 */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/60 to-black/30" />

        {/* 콘텐츠 */}
        <div className="relative z-10 p-6 sm:p-8">
          {/* 장르 뱃지 */}
          <span className="inline-block text-xs bg-white/10 border border-white/20 px-2 py-1 rounded-full mb-3">
            {show.genre}
          </span>

          <h1 className="font-display text-3xl sm:text-4xl leading-tight">
            {show.title}
          </h1>
          {show.subtitle && (
            <p className="text-white/60 italic mt-1 text-sm">{show.subtitle}</p>
          )}

          <div className="mt-5 grid sm:grid-cols-2 gap-3 text-sm text-white/80">
            <div className="flex items-start gap-2">
              <span>📍</span>
              <div>
                <p className="text-white font-medium">{show.venue}</p>
                {show.address && <p className="text-white/50 text-xs mt-0.5">{show.address}</p>}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span>🗓</span>
              <div>
                <p className="text-white">{formatDateRange(show.startDate, show.endDate)}</p>
                {show.runtime && (
                  <p className="text-white/50 text-xs mt-0.5">
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
                <span key={t} className="text-xs bg-white/15 px-2 py-0.5 rounded-full text-white">
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
              className="mt-5 inline-block px-4 py-2 bg-[#8FAF94] hover:bg-[#7A9E7F]
                         text-white text-sm font-medium rounded-lg transition-colors"
            >
              티켓 예매 →
            </a>
          )}
        </div>
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
        <CastSection
          cast={show.cast}
          showId={show.id}
          actorIdMap={actorIdMap}
        />
      )}

      {/* 댓글 */}
      <section className="bg-white border border-stone-100 rounded-xl p-5">
        <CommentSection targetId={show.id} targetType="show" />
      </section>

    </div>
  )
}
