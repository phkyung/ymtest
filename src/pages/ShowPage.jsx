// ─────────────────────────────────────────────
// ShowPage.jsx — 공연 상세 페이지 (탭 구조)
// ─────────────────────────────────────────────

import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useShow } from '../hooks/useShows'
import { useAuth } from '../hooks/useAuth'
import { toHttps } from '../utils/imageUrl'
import KeywordModal from '../components/KeywordModal'
import NosonArchive from '../components/NosonArchive'
import CommentSection from '../components/CommentSection'
import { db, isFirebaseConfigured } from '../firebase'
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore'
import { getNickname } from '../components/NicknameModal'

const TAG_OPTIONS = ['파멸극', '힐링', '로맨스', '코믹', '스릴러', '성장', '비극', '판타지', '감동', '긴장감']

const GENRE_EMOJI = {
  '뮤지컬': '🎭', '연극': '🎬', '오페라': '🎼', '콘서트': '🎵', '무용': '💃',
}
const GENRE_COLOR = {
  '뮤지컬': 'bg-amber-100 text-amber-800',
  '연극':   'bg-sky-100 text-sky-800',
  '오페라': 'bg-purple-100 text-purple-800',
}

function formatDateRange(start, end) {
  if (!start) return ''
  const fmt = d => `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`
  return `${fmt(new Date(start))} ~ ${fmt(new Date(end))}`
}

function formatDateLabel(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const days = ['일','월','화','수','목','금','토']
  return `${d.getMonth()+1}월 ${d.getDate()}일 (${days[d.getDay()]})`
}

// 공연 기간 내 날짜 목록 생성 (최대 60일)
function getShowDates(startDate, endDate) {
  if (!startDate || !endDate) return []
  const dates = []
  const cur = new Date(startDate)
  const end = new Date(endDate)
  while (cur <= end && dates.length < 60) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

// ── 시놉시스 (접기/펼치기) ────────────────────────
function Synopsis({ text }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.split('\n').length > 3 || text.length > 200

  return (
    <div>
      <p className={`text-stone-600 leading-relaxed text-sm sm:text-base whitespace-pre-line
                     ${!expanded && isLong ? 'line-clamp-3' : ''}`}>
        {text}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-2 text-xs text-[#8FAF94] hover:text-[#7A9E7F] font-medium transition-colors"
        >
          {expanded ? '접기 ▲' : '더 보기 ▼'}
        </button>
      )}
    </div>
  )
}

// ── 배우 이니셜 아바타 ────────────────────────────
function ActorAvatar({ name, imageUrl }) {
  const [imgError, setImgError] = useState(false)
  if (imageUrl && !imgError) {
    return (
      <img
        src={toHttps(imageUrl)}
        alt={name}
        onError={() => setImgError(true)}
        className="w-8 h-8 rounded-full object-cover shrink-0"
      />
    )
  }
  return (
    <div className="w-8 h-8 rounded-full bg-[#2C1810] text-white flex items-center
                    justify-center text-xs font-semibold shrink-0">
      {name?.[0] ?? '?'}
    </div>
  )
}

// ── 출연진 탭 ─────────────────────────────────────
function CastSection({ cast, showId, actorIdMap }) {
  const enriched = cast.map(m => ({
    ...m,
    resolvedId: actorIdMap[m.actorName] || m.actorId || null,
  }))

  // 역할별 그룹
  const groups = []
  const groupMap = {}
  enriched.forEach(m => {
    const role = m.roleName?.trim() || '출연'
    if (!groupMap[role]) { groupMap[role] = []; groups.push(role) }
    groupMap[role].push(m)
  })

  const [modal, setModal] = useState({ open: false, actor: null })

  return (
    <div className="space-y-4">

      {/* 역할별 배우 목록 */}
      <div className="bg-white border border-stone-100 rounded-2xl p-5 space-y-5">
        {groups.map(role => (
          <div key={role}>
            <p className="text-xs font-semibold text-[#6B5E52] uppercase tracking-wide
                          border-b border-[#E8E4DF] pb-1.5 mb-3">
              {role}
            </p>
            <div className="flex flex-wrap gap-2">
              {groupMap[role].map((m, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  {m.resolvedId ? (
                    <Link
                      to={`/actors/${m.resolvedId}`}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full border
                                 border-[#C8D8CA] text-[#4A6B4F] text-sm font-medium
                                 hover:bg-[#8FAF94] hover:text-white hover:border-[#8FAF94]
                                 transition-colors group"
                    >
                      <ActorAvatar name={m.actorName} imageUrl={m.imageUrl} />
                      <span>{m.actorName}</span>
                      {m.isDouble && (
                        <span className="text-[10px] opacity-60 group-hover:opacity-80">더블</span>
                      )}
                    </Link>
                  ) : (
                    <span
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full border
                                 border-stone-100 text-stone-500 text-sm"
                    >
                      <ActorAvatar name={m.actorName} imageUrl={m.imageUrl} />
                      {m.actorName}
                    </span>
                  )}
                  <button
                    onClick={() => setModal({ open: true, actor: m })}
                    className="text-xs border border-[#8FAF94] text-[#8FAF94]
                               rounded-full px-2 py-0.5 hover:bg-[#8FAF94]/10 transition-colors"
                  >
                    키워드 선택
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 키워드 모달 */}
      {modal.open && (
        <KeywordModal
          showId={showId}
          actor={modal.actor}
          cast={enriched}
          onClose={() => setModal({ open: false, actor: null })}
        />
      )}
    </div>
  )
}

// ── 날짜별 후기 탭 ────────────────────────────────
function ReviewTab({ show, actorIdMap }) {
  const dates = getShowDates(show.startDate, show.endDate)
  const today = new Date().toISOString().slice(0, 10)
  const defaultDate = dates.includes(today) ? today : (dates[0] ?? null)
  const [selectedDate, setSelectedDate] = useState(defaultDate)

  const enrichedCast = (show.cast ?? []).map(m => ({
    ...m,
    resolvedId: actorIdMap[m.actorName] || m.actorId || null,
  }))

  if (dates.length === 0) {
    return (
      <p className="text-sm text-stone-400 py-8 text-center">공연 날짜 정보가 없습니다.</p>
    )
  }

  // 날짜 그룹: 월별로 묶기
  const byMonth = {}
  dates.forEach(d => {
    const month = d.slice(0, 7)
    if (!byMonth[month]) byMonth[month] = []
    byMonth[month].push(d)
  })

  return (
    <div className="space-y-6">

      {/* 날짜 선택 — 월별 그룹 */}
      <div className="space-y-3">
        {Object.entries(byMonth).map(([month, ds]) => {
          const [y, m] = month.split('-')
          return (
            <div key={month}>
              <p className="text-xs font-semibold text-stone-400 mb-2">
                {parseInt(y)}년 {parseInt(m)}월
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {ds.map(d => {
                  const date = new Date(d)
                  const day  = ['일','월','화','수','목','금','토'][date.getDay()]
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6
                  const isPast    = d < today
                  const isToday   = d === today
                  return (
                    <button
                      key={d}
                      onClick={() => setSelectedDate(d)}
                      className={`flex flex-col items-center px-2.5 py-2 rounded-xl
                                  text-xs font-medium transition-all min-w-[44px] ${
                        selectedDate === d
                          ? 'bg-[#2C1810] text-white shadow-sm'
                          : isToday
                            ? 'bg-[#EEF5EF] text-[#4A6B4F] border border-[#8FAF94]'
                            : isPast
                              ? 'bg-stone-50 text-stone-300 border border-stone-100'
                              : 'bg-white border border-[#E8E4DF] text-stone-600 hover:border-[#8FAF94] hover:text-[#4A6B4F]'
                      }`}
                    >
                      <span className={
                        selectedDate !== d && isWeekend
                          ? (date.getDay() === 0 ? 'text-red-400' : 'text-blue-400')
                          : ''
                      }>
                        {day}
                      </span>
                      <span className="font-semibold mt-0.5">{date.getDate()}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {selectedDate && (
        <div className="space-y-4">
          {/* 날짜 헤더 */}
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-semibold text-[#2C1810]">
              {formatDateLabel(selectedDate)}
            </h3>
            {selectedDate === today && (
              <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full animate-pulse">
                오늘
              </span>
            )}
          </div>

          {/* 출연진 */}
          {enrichedCast.length > 0 && (
            <div className="bg-[#FAF8F5] rounded-xl p-4">
              <p className="text-xs font-semibold text-stone-400 mb-3">출연진</p>
              <div className="flex flex-wrap gap-2">
                {enrichedCast.map((m, idx) =>
                  m.resolvedId ? (
                    <Link
                      key={idx}
                      to={`/actors/${m.resolvedId}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#C8D8CA]
                                 rounded-full text-xs text-[#4A6B4F] hover:bg-[#8FAF94] hover:text-white
                                 hover:border-[#8FAF94] transition-colors"
                    >
                      {m.actorName}
                      {m.roleName && <span className="opacity-60">· {m.roleName}</span>}
                    </Link>
                  ) : (
                    <span
                      key={idx}
                      className="px-3 py-1.5 bg-white border border-stone-100 rounded-full
                                 text-xs text-stone-500"
                    >
                      {m.actorName}
                      {m.roleName && <span className="opacity-60"> · {m.roleName}</span>}
                    </span>
                  )
                )}
              </div>
            </div>
          )}

          {/* 날짜별 후기 댓글 */}
          <div className="bg-white border border-stone-100 rounded-2xl p-5">
            <p className="text-xs text-stone-400 mb-4">
              이 날 공연을 보셨나요? 첫 번째 후기를 남겨보세요 ✍️
            </p>
            <CommentSection
              targetId={`${show.id}_${selectedDate}`}
              targetType="show_date"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────
export default function ShowPage() {
  const { showId } = useParams()
  const [searchParams] = useSearchParams()
  const { show, loading } = useShow(showId)
  const { user, signIn } = useAuth()
  const [actorIdMap, setActorIdMap] = useState({})

  const VALID_TABS = ['info', 'cast', 'archive', 'review']
  const [tab, setTab] = useState(() => {
    const t = searchParams.get('tab')
    return VALID_TABS.includes(t) ? t : 'info'
  })
  const [posterError, setPosterError] = useState(false)

  // 태그 제안 모달
  const [suggestOpen,    setSuggestOpen]    = useState(false)
  const [suggestTag,     setSuggestTag]     = useState('')
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestDone,    setSuggestDone]    = useState(false)

  async function handleSuggestSubmit() {
    if (!suggestTag || suggestLoading) return
    setSuggestLoading(true)
    try {
      if (isFirebaseConfigured && db) {
        await addDoc(collection(db, 'tagSuggestions'), {
          showId,
          showTitle: show.title,
          tag: suggestTag,
          userId: user?.uid ?? '',
          nickname: getNickname(),
          status: 'pending',
          createdAt: serverTimestamp(),
        })
      }
      setSuggestDone(true)
      setSuggestOpen(false)
      setSuggestTag('')
      setTimeout(() => setSuggestDone(false), 3000)
    } catch (err) {
      console.error('태그 제안 오류:', err)
    } finally {
      setSuggestLoading(false)
    }
  }

  useEffect(() => {
    if (!show?.cast?.length || !isFirebaseConfigured || !db) return
    getDocs(collection(db, 'actors')).then(snap => {
      const map = {}
      snap.docs.forEach(d => { if (d.data().name) map[d.data().name] = d.id })
      setActorIdMap(map)
    }).catch(err => console.error('배우 ID 조회 오류:', err))
  }, [show])

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 max-w-3xl mx-auto">
        <div className="h-5 bg-stone-100 rounded w-20" />
        <div className="flex gap-5">
          <div className="w-32 h-48 bg-stone-100 rounded-xl shrink-0" />
          <div className="flex-1 space-y-3 pt-1">
            <div className="h-7 bg-stone-100 rounded w-3/4" />
            <div className="h-4 bg-stone-100 rounded w-1/2" />
            <div className="h-4 bg-stone-100 rounded w-2/3" />
          </div>
        </div>
      </div>
    )
  }

  if (!show) {
    return (
      <div className="text-center py-16 text-stone-400">
        <p className="text-4xl mb-3">🎭</p>
        <p className="font-display text-lg">공연을 찾을 수 없습니다</p>
        <Link to="/" className="mt-4 inline-block text-sm text-[#8FAF94] underline">
          목록으로
        </Link>
      </div>
    )
  }

  const posterSrc = show.imageUrl || show.posterUrl || ''
  const hasPoster = posterSrc && !posterError

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* 뒤로가기 */}
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-stone-400 text-sm hover:text-stone-600 transition-colors"
      >
        ← 공연 목록
      </Link>

      {/* ── 헤더: 포스터 + 기본 정보 ── */}
      <section className="flex gap-5 items-start">
        {/* 포스터 */}
        <div className="shrink-0 w-28 sm:w-36 rounded-xl overflow-hidden border border-stone-100
                        shadow-sm bg-[#FAF8F5] aspect-[2/3] flex items-center justify-center">
          {hasPoster ? (
            <img
              src={toHttps(posterSrc)}
              alt={show.title}
              onError={() => setPosterError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-4xl">{GENRE_EMOJI[show.genre] ?? '🎭'}</span>
          )}
        </div>

        {/* 기본 정보 */}
        <div className="flex-1 min-w-0 pt-1">
          <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium mb-2
                            ${GENRE_COLOR[show.genre] ?? 'bg-stone-100 text-stone-600'}`}>
            {show.genre}
          </span>

          <h1 className="font-display text-2xl sm:text-3xl text-[#2C1810] leading-tight">
            {show.title}
          </h1>
          {show.subtitle && (
            <p className="text-stone-400 italic text-sm mt-0.5">{show.subtitle}</p>
          )}

          <div className="mt-4 space-y-1.5 text-sm">
            <div className="flex items-start gap-2 text-stone-600">
              <span className="shrink-0">📍</span>
              <div>
                <span className="font-medium text-[#2C1810]">{show.venue}</span>
                {show.address && (
                  <span className="text-stone-400 text-xs ml-1.5">{show.address}</span>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2 text-stone-600">
              <span className="shrink-0">🗓</span>
              <div>
                <span>{formatDateRange(show.startDate, show.endDate)}</span>
                {show.runtime && (
                  <span className="text-stone-400 text-xs ml-1.5">
                    {show.runtime}분{show.intermission > 0 ? ' (인터미션 포함)' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>

          {show.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {show.tags.map(t => (
                <span key={t} className="text-xs bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full">
                  #{t}
                </span>
              ))}
            </div>
          )}

          {show.topKeywords?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {show.topKeywords.slice(0, 2).map(kw => (
                <span key={kw} className="text-xs bg-[#8FAF94]/10 text-[#8FAF94] rounded-full px-2 py-0.5">
                  {kw}
                </span>
              ))}
            </div>
          )}

          {show.ticketUrl && (
            <a
              href={show.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block px-4 py-2 bg-[#8FAF94] hover:bg-[#7A9E7F]
                         text-white text-sm font-medium rounded-xl transition-colors"
            >
              티켓 예매 →
            </a>
          )}
        </div>
      </section>

      {/* ── 탭 네비게이션 ── */}
      <div className="border-b border-[#E8E4DF]">
        <div className="flex">
          {[
            { key: 'info',    label: '정보' },
            { key: 'cast',    label: `출연진${show.cast?.length ? ` ${show.cast.length}` : ''}` },
            { key: 'archive', label: '노선 아카이브' },
            { key: 'review',  label: '날짜별 후기' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-3 text-sm font-medium transition-all border-b-2 -mb-px ${
                tab === t.key
                  ? 'border-[#2C1810] text-[#2C1810]'
                  : 'border-transparent text-stone-400 hover:text-stone-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 탭 콘텐츠 ── */}
      <div className="min-h-[300px]">

        {/* 정보 탭 */}
        {tab === 'info' && (
          <div className="space-y-6">
            {show.synopsis && (
              <section>
                <h2 className="font-display text-lg text-[#2C1810] mb-3">작품 소개</h2>
                <Synopsis text={show.synopsis} />
              </section>
            )}

            {/* 이 공연의 성격 (showTags) */}
            {(show.showTags?.length > 0 || show.topKeywords?.length > 0) && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-[#8FAF94] font-medium">이 공연의 성격</p>
                  <button
                    onClick={() => {
                      if (!user) { signIn(); return }
                      setSuggestOpen(true)
                    }}
                    className="text-xs text-stone-400 hover:text-[#8FAF94] transition-colors"
                  >
                    + 제안하기
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {show.showTags?.map(tag => (
                    <span key={tag}
                      className="bg-[#2C1810]/10 text-[#2C1810] rounded-full px-3 py-1 text-sm font-medium">
                      {tag}
                    </span>
                  ))}
                  {show.topKeywords?.map(kw => (
                    <span key={kw}
                      className="bg-[#8FAF94]/15 text-[#2C1810] rounded-full px-3 py-1 text-sm">
                      ✦ {kw}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* showTags만 있고 topKeywords 없을 때도 제안 버튼 보이게 */}
            {!show.showTags?.length && !show.topKeywords?.length && (
              <section>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-stone-300">등록된 태그가 없습니다</p>
                  <button
                    onClick={() => {
                      if (!user) { signIn(); return }
                      setSuggestOpen(true)
                    }}
                    className="text-xs text-stone-400 hover:text-[#8FAF94] transition-colors"
                  >
                    + 태그 제안하기
                  </button>
                </div>
              </section>
            )}

            <section className="bg-[#FAF8F5] rounded-2xl p-5 space-y-3 text-sm">
              {show.venue && (
                <div className="flex gap-3">
                  <span className="text-stone-400 w-16 shrink-0">공연장</span>
                  <span className="text-[#2C1810] font-medium">{show.venue}</span>
                </div>
              )}
              {(show.startDate || show.endDate) && (
                <div className="flex gap-3">
                  <span className="text-stone-400 w-16 shrink-0">공연 기간</span>
                  <span className="text-stone-700">{formatDateRange(show.startDate, show.endDate)}</span>
                </div>
              )}
              {show.runtime && (
                <div className="flex gap-3">
                  <span className="text-stone-400 w-16 shrink-0">상연 시간</span>
                  <span className="text-stone-700">
                    {show.runtime}분
                    {show.intermission > 0 && ` (인터미션 ${show.intermission}분 포함)`}
                  </span>
                </div>
              )}
            </section>

          </div>
        )}

        {/* 출연진 탭 */}
        {tab === 'cast' && (
          show.cast?.length > 0 ? (
            <CastSection
              cast={show.cast}
              showId={show.id}
              actorIdMap={actorIdMap}
            />
          ) : (
            <div className="text-center py-16 text-stone-300">
              <p className="text-3xl mb-2">👥</p>
              <p className="text-sm text-stone-400">등록된 출연진 정보가 없습니다</p>
            </div>
          )
        )}

        {/* 노선 아카이브 탭 */}
        {tab === 'archive' && (
          <NosonArchive
            showId={show.id}
            cast={show.cast ?? []}
            actorIdMap={actorIdMap}
          />
        )}

        {/* 날짜별 후기 탭 */}
        {tab === 'review' && (
          <ReviewTab show={show} actorIdMap={actorIdMap} />
        )}

      </div>

      {/* ── 태그 제안 모달 ── */}
      {suggestOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40"
             onClick={e => e.target === e.currentTarget && setSuggestOpen(false)}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[#2C1810]">태그 제안</h3>
              <button onClick={() => setSuggestOpen(false)}
                className="text-stone-400 hover:text-stone-600 text-lg leading-none">✕</button>
            </div>
            <p className="text-xs text-stone-400">
              이 공연의 성격을 가장 잘 표현하는 태그를 선택해주세요. 검토 후 반영됩니다.
            </p>
            <div className="flex flex-wrap gap-2">
              {TAG_OPTIONS.map(tag => (
                <button key={tag} onClick={() => setSuggestTag(t => t === tag ? '' : tag)}
                  className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                    suggestTag === tag
                      ? 'bg-[#2C1810] text-white border-[#2C1810]'
                      : 'bg-white border-stone-200 text-stone-600 hover:border-stone-400'
                  }`}>
                  {tag}
                </button>
              ))}
            </div>
            <button
              onClick={handleSuggestSubmit}
              disabled={!suggestTag || suggestLoading}
              className="w-full py-2.5 bg-[#8FAF94] hover:bg-[#7A9E7F] text-white text-sm font-medium
                         rounded-xl transition-colors disabled:opacity-40"
            >
              {suggestLoading ? '제출 중...' : '제안하기'}
            </button>
          </div>
        </div>
      )}

      {/* 제안 완료 토스트 */}
      {suggestDone && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#2C1810] text-white
                        rounded-lg px-4 py-2 text-sm shadow-lg pointer-events-none">
          제안이 접수됐어요! 검토 후 반영됩니다 🙌
        </div>
      )}

      {/* ── 댓글 (정보·출연진 탭에서만 표시) ── */}
      {tab !== 'review' && tab !== 'archive' && (
        <>
          <hr className="border-[#E8E4DF]" />
          <section className="bg-white border border-stone-100 rounded-2xl p-5">
            <CommentSection targetId={show.id} targetType="show" />
          </section>
        </>
      )}

    </div>
  )
}
