// ─────────────────────────────────────────────
// ActorArchive.jsx — 배우 아카이브
//   상단: 배우 이름 검색
//   중단: 누적 노선 키워드 랭킹
//   하단: 화제의 페어 케미
// ─────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, isFirebaseConfigured } from '../firebase'
import { collection, getDocs, query, orderBy } from 'firebase/firestore'
import { toHttps } from '../utils/imageUrl'

// ── 배우 전체 로드 ─────────────────────────────
function useActors() {
  const [actors, setActors]   = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!isFirebaseConfigured || !db) { setLoading(false); return }
    getDocs(query(collection(db, 'actors'), orderBy('name')))
      .then(snap => setActors(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .finally(() => setLoading(false))
  }, [])
  return { actors, loading }
}

// ── 키워드 랭킹 로드 ───────────────────────────
// keywords 컬렉션 구조: { actorId, actorName, keyword, count }
function useKeywordRanking() {
  const [ranking, setRanking] = useState([])   // [{ keyword, total, topActors }]
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return
    getDocs(collection(db, 'keywords')).then(snap => {
      // 태그별 합산 + 배우별 합산
      const tagTotals  = {}  // keyword → total count
      const tagActors  = {}  // keyword → { actorName → count }
      snap.docs.forEach(d => {
        const { keyword, actorName, count = 0 } = d.data()
        if (!keyword) return
        tagTotals[keyword] = (tagTotals[keyword] ?? 0) + count
        if (!tagActors[keyword]) tagActors[keyword] = {}
        tagActors[keyword][actorName] = (tagActors[keyword][actorName] ?? 0) + count
      })
      const sorted = Object.entries(tagTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([keyword, total]) => {
          const topActors = Object.entries(tagActors[keyword] ?? {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name]) => name)
          return { keyword, total, topActors }
        })
      setRanking(sorted)
    })
  }, [])
  return ranking
}

// ── 페어 케미 로드 ─────────────────────────────
// pairVotes 컬렉션 구조: { actorAName, actorBName, keyword, count }
function usePairRanking() {
  const [pairs, setPairs] = useState([])  // [{ key, actorAName, actorBName, total, topKeywords }]
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return
    getDocs(collection(db, 'pairVotes')).then(snap => {
      const pairTotals   = {}  // "A×B" → total
      const pairKeywords = {}  // "A×B" → { keyword → count }
      const pairNames    = {}  // "A×B" → { actorAName, actorBName }
      snap.docs.forEach(d => {
        const { actorAName, actorBName, keyword, count = 0 } = d.data()
        if (!actorAName || !actorBName) return
        // 이름 정렬로 방향 통일
        const [a, b] = [actorAName, actorBName].sort()
        const key = `${a}×${b}`
        pairTotals[key] = (pairTotals[key] ?? 0) + count
        pairNames[key]  = { actorAName: a, actorBName: b }
        if (!pairKeywords[key]) pairKeywords[key] = {}
        if (keyword) pairKeywords[key][keyword] = (pairKeywords[key][keyword] ?? 0) + count
      })
      const sorted = Object.entries(pairTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key, total]) => {
          const topKeywords = Object.entries(pairKeywords[key] ?? {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([kw]) => kw)
          return { key, ...pairNames[key], total, topKeywords }
        })
      setPairs(sorted)
    })
  }, [])
  return pairs
}

// ── 검색 결과 카드 ─────────────────────────────
function SearchResultCard({ actor, onClick }) {
  const imgSrc = actor.imageUrl ? toHttps(actor.imageUrl) : null
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-[#E8E4DF]
                 hover:border-[#8FAF94] hover:shadow-sm transition-all w-full text-left"
    >
      <div className="w-10 h-10 rounded-full overflow-hidden bg-stone-100 flex items-center justify-center shrink-0">
        {imgSrc ? (
          <img src={imgSrc} alt={actor.name} className="w-full h-full object-cover"
               onError={e => { e.currentTarget.style.display = 'none' }} />
        ) : (
          <span className="text-lg text-stone-300">🎭</span>
        )}
      </div>
      <span className="font-medium text-[#2C1810] text-sm">{actor.name}</span>
    </button>
  )
}

// ── 키워드 랭킹 바 ─────────────────────────────
function KeywordBar({ keyword, total, topActors, max }) {
  const pct = max > 0 ? Math.round((total / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-[#2C1810] w-20 shrink-0 text-right font-medium">{keyword}</span>
      <div className="flex-1 relative h-7 bg-stone-100 rounded-lg overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-[#8FAF94]/60 rounded-lg transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
        {topActors.length > 0 && (
          <span className="absolute inset-y-0 left-3 flex items-center text-xs text-[#2C5F35] font-medium z-10">
            {topActors.join(' · ')}
          </span>
        )}
      </div>
      <span className="text-xs text-stone-400 w-10 shrink-0 text-right">{total}</span>
    </div>
  )
}

// ── 메인 ──────────────────────────────────────
export default function ActorArchive() {
  const { actors, loading } = useActors()
  const keywordRanking      = useKeywordRanking()
  const pairRanking         = usePairRanking()
  const [searchTerm, setSearchTerm] = useState('')
  const navigate  = useNavigate()
  const inputRef  = useRef(null)

  const trimmed  = searchTerm.trim()
  const filtered = trimmed ? actors.filter(a => a.name?.includes(trimmed)) : []
  const maxCount = keywordRanking[0]?.total ?? 1

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#2C1810]">
      <div className="max-w-2xl mx-auto px-4 py-10">

        {/* 헤더 */}
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold mb-1">배우 아카이브</h1>
          <p className="text-[#6B5E52] text-sm">배우의 노선과 케미를 기록합니다</p>
        </div>

        {/* ── 검색창 ── */}
        <div className="relative mb-2">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 pointer-events-none">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="배우 이름으로 검색..."
            className="w-full pl-11 pr-10 py-3 rounded-xl border border-[#E8E4DF] bg-white
                       text-[#2C1810] placeholder-stone-300 text-sm
                       focus:outline-none focus:border-[#8FAF94] focus:ring-1 focus:ring-[#8FAF94]"
          />
          {searchTerm && (
            <button
              onClick={() => { setSearchTerm(''); inputRef.current?.focus() }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500 text-sm"
            >✕</button>
          )}
        </div>

        {/* ── 검색 결과 ── */}
        {trimmed && (
          <div className="mb-8 flex flex-col gap-2">
            {loading ? (
              <p className="text-sm text-stone-400 py-4 text-center">불러오는 중...</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-stone-400 py-4 text-center">검색 결과가 없어요</p>
            ) : (
              filtered.map(actor => (
                <SearchResultCard
                  key={actor.id}
                  actor={actor}
                  onClick={() => navigate(`/actors/${actor.id}`)}
                />
              ))
            )}
          </div>
        )}

        {/* 검색 중이 아닐 때: 랭킹 섹션 */}
        {!trimmed && (
          <>
            {/* ── 누적 노선 키워드 랭킹 ── */}
            <section className="mt-10">
              <h2 className="text-base font-bold text-[#2C1810] mb-4">누적 노선 키워드 랭킹</h2>
              {keywordRanking.length === 0 ? (
                <p className="text-sm text-stone-400 text-center py-8">집계 데이터가 없어요</p>
              ) : (
                <div className="bg-white rounded-2xl border border-[#E8E4DF] px-5 py-5 flex flex-col gap-3">
                  {keywordRanking.map(({ keyword, total, topActors }) => (
                    <KeywordBar
                      key={keyword}
                      keyword={keyword}
                      total={total}
                      topActors={topActors}
                      max={maxCount}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* ── 화제의 페어 케미 ── */}
            {pairRanking.length > 0 && (
              <section className="mt-10">
                <h2 className="text-base font-bold text-[#2C1810] mb-4">화제의 페어</h2>
                <div className="flex flex-col gap-3">
                  {pairRanking.map(({ key, actorAName, actorBName, topKeywords }) => (
                    <div
                      key={key}
                      className="bg-white rounded-2xl border border-[#E8E4DF] px-5 py-4 flex items-center gap-4"
                    >
                      <span className="font-semibold text-[#2C1810] text-sm">
                        {actorAName}
                        <span className="mx-2 text-[#8FAF94]">×</span>
                        {actorBName}
                      </span>
                      <div className="flex gap-1.5 flex-wrap">
                        {topKeywords.map(kw => (
                          <span
                            key={kw}
                            className="text-xs px-2 py-0.5 rounded-full bg-[#D4E6D7] text-[#2C5F35] font-medium"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

      </div>
    </div>
  )
}
