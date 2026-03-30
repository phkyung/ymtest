// ─────────────────────────────────────────────
// ActorArchive.jsx — 배우 아카이브 목록 + 검색
// ─────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, isFirebaseConfigured } from '../firebase'
import { collection, getDocs, query, orderBy } from 'firebase/firestore'
import { toHttps } from '../utils/imageUrl'

// actors 컬렉션 전체 로드 (검색은 클라이언트 필터)
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

function ActorCard({ actor, onClick }) {
  const imgSrc = actor.imageUrl ? toHttps(actor.imageUrl) : null
  const keywords = Array.isArray(actor.topKeywords) ? actor.topKeywords.slice(0, 3) : []

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-4 bg-white rounded-2xl border border-[#E8E4DF]
                 shadow-sm hover:shadow-md hover:border-[#8FAF94] transition-all text-left w-full"
    >
      {/* 프로필 사진 */}
      <div className="w-20 h-20 rounded-full overflow-hidden bg-stone-100 flex items-center justify-center shrink-0">
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={actor.name}
            className="w-full h-full object-cover"
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <span className="text-3xl text-stone-300">🎭</span>
        )}
      </div>

      {/* 이름 */}
      <span className="font-semibold text-[#2C1810] text-sm text-center leading-tight">
        {actor.name}
      </span>

      {/* 상위 키워드 */}
      {keywords.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1">
          {keywords.map(kw => (
            <span
              key={kw}
              className="text-xs px-2 py-0.5 rounded-full bg-[#D4E6D7] text-[#2C5F35] font-medium"
            >
              {kw}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

export default function ActorArchive() {
  const { actors, loading } = useActors()
  const [query_, setQuery]  = useState('')
  const navigate            = useNavigate()
  const inputRef            = useRef(null)

  const filtered = query_.trim()
    ? actors.filter(a => a.name?.includes(query_.trim()))
    : actors

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#2C1810]">
      <div className="max-w-4xl mx-auto px-4 py-10">

        {/* 헤더 */}
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold mb-1">배우 아카이브</h1>
          <p className="text-[#6B5E52] text-sm">배우의 노선과 케미를 기록합니다</p>
        </div>

        {/* 검색창 */}
        <div className="relative mb-8">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 text-lg pointer-events-none">
            🔍
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query_}
            onChange={e => setQuery(e.target.value)}
            placeholder="배우 이름으로 검색..."
            className="w-full pl-11 pr-4 py-3 rounded-xl border border-[#E8E4DF] bg-white
                       text-[#2C1810] placeholder-stone-300 text-sm
                       focus:outline-none focus:border-[#8FAF94] focus:ring-1 focus:ring-[#8FAF94]"
          />
          {query_ && (
            <button
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500 text-sm"
            >
              ✕
            </button>
          )}
        </div>

        {/* 결과 */}
        {loading ? (
          <p className="text-center text-stone-400 py-20 text-sm">불러오는 중...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-stone-400 py-20 text-sm">검색 결과가 없어요</p>
        ) : (
          <>
            {query_.trim() && (
              <p className="text-xs text-stone-400 mb-4">
                "{query_.trim()}" 검색 결과 {filtered.length}명
              </p>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {filtered.map(actor => (
                <ActorCard
                  key={actor.id}
                  actor={actor}
                  onClick={() => navigate(`/actors/${actor.id}`)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
