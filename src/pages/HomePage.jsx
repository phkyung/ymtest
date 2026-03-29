// ─────────────────────────────────────────────
// HomePage.jsx — 공연 목록 + AI 검색 + 필터
// ─────────────────────────────────────────────

import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useShows } from '../hooks/useShows'
import ShowCard from '../components/ShowCard'
import { isFirebaseConfigured } from '../firebase'

const AI_WORKER_URL = 'https://playpick-ai.merhen08.workers.dev'

// 오늘 공연 여부 판단
function isPlayingToday(startDate, endDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(startDate) <= today && today <= new Date(endDate)
}

const GENRE_OPTIONS = ['전체', '뮤지컬', '연극']

const MOOD_TAGS = [
  '파멸극', '힐링', '로맨스', '코믹', '스릴러',
  '성장', '비극', '판타지', '감동', '긴장감',
]

const GENRE_COLOR = {
  '뮤지컬': 'bg-amber-100 text-amber-800',
  '연극':   'bg-sky-100 text-sky-800',
  '오페라': 'bg-purple-100 text-purple-800',
  '콘서트': 'bg-pink-100 text-pink-800',
}

const SHOW_TAG_COLORS = {
  '파멸극': '#2C1810',
  '힐링':   '#8FAF94',
  '로맨스': '#E8A598',
  '코믹':   '#F5C842',
  '스릴러': '#6B7280',
  '성장':   '#7BAE8A',
  '비극':   '#8B6B8B',
  '판타지': '#7B9EC4',
  '감동':   '#E8C49A',
  '긴장감': '#C4846B',
}

export default function HomePage() {
  const { shows, loading } = useShows()

  // 일반 검색
  const [query, setQuery] = useState('')

  // 장르·오늘 필터
  const [filter, setFilter]       = useState('전체')
  const [todayOnly, setTodayOnly] = useState(false)

  // 분위기 태그 필터
  const [moodTag, setMoodTag] = useState('')

  // AI 검색
  const [aiInput, setAiInput]       = useState('')
  const [aiKeywords, setAiKeywords] = useState([])   // Worker 응답 keywords
  const [aiLoading, setAiLoading]   = useState(false)
  const [aiError, setAiError]       = useState('')

  // AI 검색 실행
  async function handleAiSearch() {
    const q = aiInput.trim()
    if (!q) return
    setAiLoading(true)
    setAiError('')
    setAiKeywords([])
    try {
      const res = await fetch(AI_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
      const data = await res.json()
      if (!Array.isArray(data.keywords) || data.keywords.length === 0) {
        setAiError('관련 키워드를 찾지 못했어요. 다르게 표현해 보세요.')
      } else {
        setAiKeywords(data.keywords)
      }
    } catch (e) {
      setAiError('AI 검색 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.')
      console.error('AI 검색 오류:', e)
    } finally {
      setAiLoading(false)
    }
  }

  function clearAi() {
    setAiKeywords([])
    setAiInput('')
    setAiError('')
  }

  // 필터 + 검색 + AI 키워드 적용
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const kws = aiKeywords.map(k => k.toLowerCase())

    return shows.filter(s => {
      const genreOk = filter === '전체' || s.genre === filter
      const todayOk = !todayOnly || isPlayingToday(s.startDate, s.endDate)

      const words = q ? q.split(/\s+/).filter(Boolean) : []
      const searchOk = words.length === 0 || words.every(word =>
        s.title?.toLowerCase().includes(word) ||
        s.venue?.toLowerCase().includes(word) ||
        s.genre?.toLowerCase().includes(word) ||
        s.synopsis?.toLowerCase().includes(word) ||
        s.cast?.some(c => c.actorName?.toLowerCase().includes(word))
      )

      const aiOk = kws.length === 0 || kws.some(kw =>
        s.title?.toLowerCase().includes(kw) ||
        s.genre?.toLowerCase().includes(kw) ||
        s.synopsis?.toLowerCase().includes(kw) ||
        s.venue?.toLowerCase().includes(kw) ||
        s.keywords?.some(k => k.toLowerCase().includes(kw)) ||
        s.showTags?.some(t => t.toLowerCase().includes(kw)) ||
        s.topKeywords?.some(t => t.toLowerCase().includes(kw)) ||
        s.cast?.some(c => c.actorName?.toLowerCase().includes(kw))
      )

      const moodOk = !moodTag || s.showTags?.includes(moodTag)

      return genreOk && todayOk && searchOk && aiOk && moodOk
    })
  }, [shows, filter, todayOnly, query, aiKeywords, moodTag])

  const todayCount = shows.filter(s => isPlayingToday(s.startDate, s.endDate)).length

  // 화제 노선&케미 — topKeywords 있는 공연, 최대 8개
  const nosonShows = useMemo(() =>
    shows.filter(s => s.topKeywords?.length > 0).slice(0, 8)
  , [shows])

  // showTags 집계 — 태그별 공연 수, 내림차순
  const showTagStats = useMemo(() => {
    const tally = {}
    shows.forEach(s => {
      s.showTags?.forEach(tag => {
        tally[tag] = (tally[tag] ?? 0) + 1
      })
    })
    return Object.entries(tally)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
  }, [shows])

  return (
    <div>
      {/* 헤더 */}
      <section className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-[#2C1810] leading-tight">
          그날의 무대를 함께 기억하세요
        </h1>
        <p className="text-sm text-[#8FAF94] mt-1">
          연극·뮤지컬 공연 아카이브
        </p>

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

      {/* ── 분위기로 찾기 ── */}
      <div className="mb-5">
        <p className="text-sm text-[#8FAF94] font-medium mb-2">장르로 찾기</p>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {MOOD_TAGS.map(tag => (
            <button
              key={tag}
              onClick={() => setMoodTag(t => t === tag ? '' : tag)}
              className={`text-xs border rounded-full px-3 py-1.5 whitespace-nowrap shrink-0
                          transition-colors ${
                moodTag === tag
                  ? 'bg-[#8FAF94] border-[#8FAF94] text-white'
                  : 'bg-white border-stone-200 text-stone-600 hover:border-[#8FAF94] hover:text-[#4A6B4F]'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* ── 극 성격 분포 ── */}
      {showTagStats.length > 0 && (
        <div className="mb-6 bg-white border border-stone-100 rounded-2xl p-4 space-y-2.5">
          <p className="text-sm text-[#2C1810] font-medium">지금 플레이픽의 공연들은</p>
          {showTagStats.map(({ tag, count }) => {
            const max   = showTagStats[0].count
            const pct   = Math.round((count / max) * 100)
            const color = SHOW_TAG_COLORS[tag] ?? '#8FAF94'
            return (
              <button
                key={tag}
                onClick={() => setMoodTag(t => t === tag ? '' : tag)}
                className="w-full flex items-center gap-3 group"
              >
                <span className={`text-xs w-14 shrink-0 text-right transition-colors ${
                  moodTag === tag ? 'font-semibold text-[#2C1810]' : 'text-stone-500'
                }`}>
                  {tag}
                </span>
                <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>
                <span className="text-xs text-stone-400 w-8 shrink-0 text-right">{count}개</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── 지금 화제의 노선&케미 ── */}
      {nosonShows.length > 0 && (
        <div className="mb-6">
          <p className="text-sm text-[#8FAF94] font-medium mb-3">지금 화제의 노선&케미</p>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {nosonShows.map(show => (
              <div
                key={show.id}
                className="min-w-[240px] w-[240px] bg-white rounded-xl border border-stone-100
                           p-4 shadow-sm shrink-0 hover:shadow-md hover:-translate-y-px
                           transition-all duration-200 flex flex-col gap-3"
              >
                {/* 공연명 + 장르 */}
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm text-[#2C1810] leading-tight line-clamp-2 flex-1">
                    {show.title}
                  </p>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium
                    ${GENRE_COLOR[show.genre] ?? 'bg-stone-100 text-stone-600'}`}>
                    {show.genre}
                  </span>
                </div>

                <hr className="border-stone-100" />

                {/* 배우별 키워드 */}
                <div className="space-y-1.5 flex-1">
                  {(show.cast ?? []).slice(0, 3).map((m, i) => (
                    <div key={i} className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-stone-500 shrink-0">{m.actorName}</span>
                      {show.topKeywords?.map(kw => (
                        <span key={kw}
                          className="text-xs bg-[#8FAF94]/15 text-[#2C1810] rounded-full px-2 py-0.5">
                          {kw}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>

                <hr className="border-stone-100" />

                {/* 노선 아카이브 링크 */}
                <Link
                  to={`/shows/${show.id}?tab=archive`}
                  className="text-xs text-[#8FAF94] hover:text-[#7A9E7F] transition-colors"
                >
                  노선 아카이브 →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── AI 검색창 ── */}
      <div className="mb-4 rounded-2xl border border-[#C8D8CA] bg-[#F4FAF5] p-4 space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={aiInput}
            onChange={e => setAiInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !aiLoading && handleAiSearch()}
            placeholder="어떤 공연이 보고 싶어요?"
            className="flex-1 px-4 py-2.5 rounded-xl border border-[#C8D8CA] bg-white
                       text-sm text-stone-800 placeholder:text-stone-300
                       focus:outline-none focus:border-[#8FAF94] focus:ring-1 focus:ring-[#8FAF94]
                       transition-colors"
          />
          <button
            onClick={handleAiSearch}
            disabled={aiLoading || !aiInput.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#8FAF94] hover:bg-[#7A9E7F]
                       text-white text-sm font-medium transition-colors disabled:opacity-50 shrink-0"
          >
            {aiLoading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <span>✨</span>
            )}
            AI 검색
          </button>
        </div>

        {/* 힌트 */}
        {!aiError && (
          <p className="text-xs text-stone-400 pl-1">
            예: 코믹극 보고 싶어 / 감동적인 뮤지컬 추천
          </p>
        )}

        {/* AI 오류 */}
        {aiError && (
          <p className="text-xs text-red-500 pl-1">{aiError}</p>
        )}
      </div>

      {/* AI 결과 뱃지 */}
      {aiKeywords.length > 0 && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-[#EEF5EF] border border-[#C8D8CA]
                        rounded-xl text-sm text-[#2C1810]">
          <span className="shrink-0">✨</span>
          <span className="font-medium">AI 검색 결과:</span>
          <span className="text-[#4A6B4F]">{aiKeywords.join(', ')}</span>
          <button
            onClick={clearAi}
            className="ml-auto shrink-0 text-stone-400 hover:text-stone-600 transition-colors text-base leading-none"
            aria-label="AI 검색 초기화"
          >
            ✕
          </button>
        </div>
      )}

      {/* 일반 검색바 */}
      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm pointer-events-none">
          🔍
        </span>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="공연명, 배우, 공연장 검색..."
          className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-stone-200 bg-white
                     text-sm text-stone-800 placeholder:text-stone-300
                     focus:outline-none focus:border-[#8FAF94] focus:ring-1 focus:ring-[#8FAF94]
                     transition-colors"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-300
                       hover:text-stone-500 transition-colors text-base leading-none"
            aria-label="검색 초기화"
          >
            ✕
          </button>
        )}
      </div>

      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
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

        {moodTag ? (
          <span className="text-sm text-[#4A6B4F] font-medium ml-auto">
            ✦ {moodTag} 공연 {filtered.length}개
          </span>
        ) : (
          <span className="text-stone-400 text-sm ml-auto">
            총 {filtered.length}개 공연
          </span>
        )}
      </div>

      {/* 로딩 스켈레톤 */}
      {loading && (
        <ul className="space-y-2">
          {[1,2,3,4,5,6,7,8].map(i => (
            <li key={i} className="bg-white rounded-xl border border-stone-100 h-12 animate-pulse flex items-center gap-3 px-3">
              <div className="h-5 w-12 bg-stone-100 rounded-full" />
              <div className="h-4 bg-stone-100 rounded w-1/3" />
              <div className="h-3 bg-stone-100 rounded w-1/4 ml-auto hidden sm:block" />
            </li>
          ))}
        </ul>
      )}

      {/* 빈 결과 */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-stone-400">
          <p className="text-4xl mb-3">🎭</p>
          <p className="font-display text-lg">해당 조건의 공연이 없습니다</p>
          <button
            onClick={() => { setFilter('전체'); setTodayOnly(false); setQuery(''); clearAi(); setMoodTag('') }}
            className="mt-4 text-sm text-amber-600 underline"
          >
            필터 초기화
          </button>
        </div>
      )}

      {/* 공연 목록 */}
      {!loading && filtered.length > 0 && (
        <ul className="space-y-2">
          {filtered.map(show => (
            <ShowCard key={show.id} show={show} />
          ))}
        </ul>
      )}
    </div>
  )
}
