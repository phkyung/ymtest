// ─────────────────────────────────────────────
// ActorPage.jsx — 배우 상세 + 출연 이력 + 키워드 집계
// ─────────────────────────────────────────────

import { useParams, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useActor } from '../hooks/useActor'
import CommentSection from '../components/CommentSection'
import { db, isFirebaseConfigured } from '../firebase'
import { collection, query, where, getDocs } from 'firebase/firestore'

// 이 배우의 모든 키워드 투표를 집계해서 상위 순으로 보여줌
function useActorKeywords(actorId) {
  const [keywords, setKeywords] = useState([])

  useEffect(() => {
    if (!actorId || !isFirebaseConfigured || !db) {
      // 더미: 랜덤 키워드 집계
      setKeywords([
        { keyword: '카리스마', count: 42 },
        { keyword: '압도적', count: 35 },
        { keyword: '섬세함', count: 28 },
        { keyword: '냉혹함', count: 21 },
        { keyword: '절제', count: 14 },
      ])
      return
    }

    // Firestore에서 이 배우의 모든 투표 집계
    const q = query(collection(db, 'votes'), where('actorId', '==', actorId))
    getDocs(q).then(snap => {
      // 키워드별 count 합산
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

// 막대 그래프 스타일 키워드 노선 표시
function KeywordBar({ keyword, count, max }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-stone-600 w-24 shrink-0 text-right">{keyword}</span>
      <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-400 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-stone-400 w-8 shrink-0">{count}</span>
    </div>
  )
}

export default function ActorPage() {
  const { actorId }  = useParams()
  const { actor, shows, loading } = useActor(actorId)
  const keywords     = useActorKeywords(actorId)

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 max-w-2xl mx-auto">
        <div className="h-6 bg-stone-100 rounded w-24" />
        <div className="h-32 bg-stone-100 rounded-xl" />
      </div>
    )
  }

  if (!actor) {
    return (
      <div className="text-center py-16 text-stone-400">
        <p className="text-4xl mb-3">👤</p>
        <p className="font-display text-lg">배우 정보를 찾을 수 없습니다</p>
        <Link to="/" className="mt-4 inline-block text-sm text-amber-600 underline">
          목록으로
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-10">

      {/* 뒤로 */}
      <Link to="/" className="inline-flex items-center gap-1 text-stone-400 text-sm hover:text-stone-700">
        ← 공연 목록
      </Link>

      {/* 배우 헤더 */}
      <section className="flex items-start gap-5">
        {/* 이니셜 아바타 */}
        <div className="w-16 h-16 rounded-full bg-stone-800 text-white flex items-center justify-center font-display text-xl shrink-0">
          {actor.name?.[0] ?? '?'}
        </div>

        <div>
          <h1 className="font-display text-3xl text-stone-900">{actor.name}</h1>
          {actor.bio && (
            <p className="text-stone-500 text-sm mt-2 leading-relaxed">{actor.bio}</p>
          )}
        </div>
      </section>

      {/* 키워드 노선 (집계) */}
      {keywords.length > 0 && (
        <section className="bg-white border border-stone-100 rounded-xl p-5">
          <h2 className="font-display text-lg text-stone-800 mb-1">
            캐릭터 노선 · 키워드 분포
          </h2>
          <p className="text-xs text-stone-400 mb-5">
            관객이 투표한 키워드를 공연 전체에서 집계한 결과입니다
          </p>

          <div className="space-y-3">
            {keywords.slice(0, 8).map((kw, i) => (
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

      {/* 출연 이력 */}
      {shows.length > 0 && (
        <section>
          <h2 className="font-display text-lg text-stone-800 mb-3">
            출연 이력
            <span className="ml-2 text-sm font-body text-stone-400 font-normal">
              ({shows.length}개 공연)
            </span>
          </h2>

          <ul className="space-y-2">
            {shows.map(show => {
              const role = show.cast?.find(c => c.actorId === actorId)
              return (
                <li key={show.id}>
                  <Link
                    to={`/shows/${show.id}`}
                    className="flex items-center justify-between gap-3 bg-white border border-stone-100
                               rounded-xl px-4 py-3 hover:border-amber-200 hover:bg-amber-50 transition-all"
                  >
                    <div>
                      <p className="font-medium text-stone-800 text-sm">{show.title}</p>
                      {role && (
                        <p className="text-xs text-stone-400 mt-0.5">
                          {role.roleName} 역
                          {role.isDouble && <span className="ml-1 text-stone-300">(더블)</span>}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-stone-400">{show.venue}</p>
                      <p className="text-xs text-stone-300 mt-0.5">
                        {show.startDate?.slice(0, 7)}
                      </p>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* 댓글 */}
      <section className="bg-white border border-stone-100 rounded-xl p-5">
        <CommentSection targetId={actorId} targetType="actor" />
      </section>

    </div>
  )
}
