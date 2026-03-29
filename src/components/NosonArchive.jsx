// ─────────────────────────────────────────────
// NosonArchive.jsx — 노선 아카이브 탭
// ─────────────────────────────────────────────

import { useState, useEffect } from 'react'
import {
  collection, doc, getDoc, getDocs,
  query, orderBy, startAt, endAt, documentId,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'
import { KEYWORD_CATEGORIES } from './KeywordVote'

const ALL_ACTOR_TAGS = KEYWORD_CATEGORIES.flatMap(c => c.tags)
const ALL_PAIR_TAGS  = ['팽팽한긴장', '다정함', '정석합', '엇갈림', '대립', '동반자', '밀당', '보호본능', '애증', '구원', '공명', '합좋음', '주고받는맛', '시너지', '주도권싸움', '균형감', '침묵케미', '눈빛케미', '상처건드림', '서사합', '상호자극', '같이무너짐', '상호파괴']

function getTopTags(data, tags, n) {
  if (!data) return []
  return tags
    .map(t => ({ tag: t, count: data[t]?.count ?? 0 }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

export default function NosonArchive({ showId, cast, actorIdMap }) {
  const enriched = cast.map(m => ({
    ...m,
    resolvedId: actorIdMap[m.actorName] || m.actorId || null,
  }))

  const idToName = Object.fromEntries(
    enriched.filter(m => m.resolvedId).map(m => [m.resolvedId, m.actorName])
  )

  const [actorKeywords, setActorKeywords] = useState({})  // { [resolvedId]: firestoreData }
  const [pairDocs, setPairDocs]           = useState([])   // [{ docId, idA, idB, nameA, nameB, data }]
  const [expandedActor, setExpandedActor] = useState(null)
  const [loading, setLoading]             = useState(true)

  useEffect(() => {
    if (!showId || !isFirebaseConfigured || !db) { setLoading(false); return }

    const actorsWithId = enriched.filter(m => m.resolvedId)

    const fetchAll = async () => {
      // 배우별 키워드
      const snaps = await Promise.all(
        actorsWithId.map(m => getDoc(doc(db, 'keywords', `${showId}_${m.resolvedId}`)))
      )
      const kwData = {}
      snaps.forEach((snap, i) => {
        if (snap.exists()) kwData[actorsWithId[i].resolvedId] = snap.data()
      })
      setActorKeywords(kwData)

      // 페어 키워드 (docId range query)
      try {
        const q = query(
          collection(db, 'pairVotes'),
          orderBy(documentId()),
          startAt(`${showId}_`),
          endAt(`${showId}_\uf8ff`)
        )
        const snap = await getDocs(q)
        const pairs = snap.docs
          .map(d => {
            const rest      = d.id.slice(showId.length + 1)
            const [idA, idB] = rest.split('_')
            return {
              docId: d.id,
              idA,
              idB,
              nameA: idToName[idA] ?? null,
              nameB: idToName[idB] ?? null,
              data:  d.data(),
            }
          })
          .filter(p => p.nameA && p.nameB)
        setPairDocs(pairs)
      } catch (e) {
        console.warn('페어 데이터 로드 실패:', e)
      }
    }

    fetchAll().finally(() => setLoading(false))
  }, [showId])

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 bg-stone-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  const actorsWithId = enriched.filter(m => m.resolvedId)

  return (
    <div className="space-y-8">

      {/* ── 배우별 노선 ── */}
      <section>
        <h3 className="text-sm font-semibold text-[#2C1810] mb-3">배우별 노선</h3>

        {actorsWithId.length === 0 ? (
          <p className="text-sm text-stone-400 text-center py-8">등록된 출연진이 없습니다</p>
        ) : (
          <div className="space-y-2">
            {actorsWithId.map(m => {
              const data      = actorKeywords[m.resolvedId] ?? null
              const topTags   = getTopTags(data, ALL_ACTOR_TAGS, 3)
              const isExpanded = expandedActor === m.resolvedId
              const sortedTags = data
                ? ALL_ACTOR_TAGS
                    .filter(t => (data[t]?.count ?? 0) > 0)
                    .sort((a, b) => (data[b]?.count ?? 0) - (data[a]?.count ?? 0))
                : []
              const maxCount = sortedTags.length > 0
                ? (data[sortedTags[0]]?.count ?? 1)
                : 1

              return (
                <div key={m.resolvedId} className="bg-white border border-stone-100 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedActor(isExpanded ? null : m.resolvedId)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left
                               hover:bg-[#FAF8F5] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-[#2C1810]">{m.actorName}</span>
                        {m.roleName?.trim() && (
                          <span className="text-xs text-stone-400">{m.roleName}</span>
                        )}
                      </div>
                      {topTags.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {topTags.map(({ tag }) => (
                            <span key={tag}
                              className="text-xs bg-[#8FAF94]/15 text-[#4A6B4F] rounded-full px-2 py-0.5">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-stone-300 mt-1">아직 기록이 없어요</p>
                      )}
                    </div>
                    <span className="text-stone-300 text-xs shrink-0">{isExpanded ? '▲' : '▼'}</span>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-stone-50 pt-3">
                      {sortedTags.length > 0 ? (
                        <div className="space-y-1.5">
                          {sortedTags.map(tag => {
                            const count = data[tag]?.count ?? 0
                            const pct   = Math.round((count / maxCount) * 100)
                            return (
                              <div key={tag} className="flex items-center gap-2">
                                <span className="text-xs min-w-[4.5rem] text-stone-600">{tag}</span>
                                <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-[#8FAF94]/60 rounded-full transition-all duration-500"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-xs text-stone-400 w-8 text-right">{count}개</span>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-stone-300 text-center py-2">아직 기록이 없어요</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── 화제 페어 ── */}
      <section>
        <hr className="border-[#E8E4DF] mb-6" />
        <h3 className="text-sm font-semibold text-[#2C1810] mb-3">화제 페어</h3>

        {pairDocs.length === 0 ? (
          <p className="text-sm text-stone-400 text-center py-8">아직 기록된 페어가 없어요</p>
        ) : (
          <div className="space-y-2">
            {pairDocs
              .sort((a, b) => {
                const sumA = ALL_PAIR_TAGS.reduce((acc, t) => acc + (a.data[t]?.count ?? 0), 0)
                const sumB = ALL_PAIR_TAGS.reduce((acc, t) => acc + (b.data[t]?.count ?? 0), 0)
                return sumB - sumA
              })
              .map(pair => {
                const topTags = getTopTags(pair.data, ALL_PAIR_TAGS, 2)
                return (
                  <div key={pair.docId}
                    className="bg-white border border-stone-100 rounded-xl px-4 py-3
                               flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-[#2C1810]">
                      <span>{pair.nameA}</span>
                      <span className="text-stone-300 text-xs">×</span>
                      <span>{pair.nameB}</span>
                    </div>
                    {topTags.length > 0 && (
                      <div className="flex gap-1 ml-auto">
                        {topTags.map(({ tag }) => (
                          <span key={tag}
                            className="text-xs bg-[#8FAF94]/15 text-[#4A6B4F] rounded-full px-2 py-0.5">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        )}
      </section>
    </div>
  )
}
