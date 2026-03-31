// ─────────────────────────────────────────────
// AdminPage.jsx — 관리자 페이지
// ─────────────────────────────────────────────
// 탭 구성:
//   - 대기 중    : pending 컬렉션, 리스트 행 + 사이드 패널 수정
//   - 공연 추가  : 폼 입력 → pending 저장
//   - 등록 완료  : shows 컬렉션, 카드 수정/삭제
// ─────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo } from 'react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, arrayMove, horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { db, isFirebaseConfigured } from '../firebase'
import { toHttps } from '../utils/imageUrl'
import {
  doc, setDoc, deleteDoc, addDoc, collection,
  onSnapshot, writeBatch, serverTimestamp,
  query, orderBy, where, getDocs, updateDoc, arrayUnion,
} from 'firebase/firestore'

const ADMIN_PW = import.meta.env.VITE_ADMIN_PASSWORD ?? 'theater2025'

const SHOW_TAGS = ['파멸극', '힐링', '로맨스', '코믹', '스릴러', '성장', '비극', '판타지', '감동', '긴장감']

// 대기 중 탭 한 페이지에 표시할 행 수
const PENDING_PAGE_SIZE = 50
// 등록 완료 탭 한 페이지에 표시할 카드 수
const SHOWS_PAGE_SIZE = 20

// 장르 선택지
const GENRES = ['뮤지컬', '연극', '오페라', '콘서트', '무용', '기타']

// 장르별 뱃지 색상
const GENRE_COLOR = {
  뮤지컬: 'bg-amber-100 text-amber-800',
  연극:   'bg-blue-100  text-blue-800',
  오페라: 'bg-purple-100 text-purple-800',
  콘서트: 'bg-pink-100  text-pink-800',
  무용:   'bg-teal-100  text-teal-800',
  기타:   'bg-stone-100 text-stone-600',
}

// 공통 스타일 상수
const INPUT = `w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm
               bg-white focus:outline-none focus:ring-2 focus:ring-amber-300
               placeholder:text-stone-300`
const LABEL = 'block text-xs font-semibold text-stone-500 mb-1'

// 새 공연 폼 초기값
const EMPTY_FORM = {
  title: '', subtitle: '', genre: '', venue: '', address: '',
  startDate: '', endDate: '', runtime: '', synopsis: '',
  ticketUrl: '', tags: '', source: '수동입력',
}


// " 등" 제거 헬퍼 ("한재아 등" → "한재아")
function cleanActorName(name) {
  return (name ?? '').replace(/\s*등$/, '').trim()
}

// 배우 이름 목록 → { name: imageUrl } 맵 (Firestore actors 컬렉션 배치 조회)
function useActorImageMap(actorNames) {
  const [imageMap, setImageMap] = useState({})
  // 이름 배열이 바뀔 때만 재조회 (join으로 의존성 단순화)
  const namesKey = actorNames.join(',')
  useEffect(() => {
    if (!namesKey || !isFirebaseConfigured || !db) return
    const names   = actorNames.filter(Boolean)
    if (!names.length) return
    // Firestore 'in' 쿼리 최대 30개 → 청크 분할
    const chunks = []
    for (let i = 0; i < names.length; i += 30) chunks.push(names.slice(i, i + 30))
    Promise.all(
      chunks.map(chunk =>
        getDocs(query(collection(db, 'actors'), where('name', 'in', chunk)))
      )
    ).then(snaps => {
      const map = {}
      snaps.forEach(snap =>
        snap.docs.forEach(d => {
          const { name, imageUrl } = d.data()
          if (name && imageUrl) map[name] = imageUrl
        })
      )
      setImageMap(prev => ({ ...prev, ...map }))
    }).catch(() => {})
  }, [namesKey]) // eslint-disable-line react-hooks/exhaustive-deps
  return imageMap
}

// 동명이인 구분 라벨: 같은 이름이 여러 명이면 bio 앞부분 또는 #1/#2 반환
function getDuplicateLabel(actor, allResults) {
  const same = allResults.filter(a => a.name === actor.name)
  if (same.length <= 1) return null
  if (actor.bio?.trim()) return actor.bio.trim().slice(0, 20)
  const idx = same.findIndex(a => a.id === actor.id)
  return `#${idx + 1}`
}

// ── 출연진 편집 섹션 (수정 폼용) ─────────────────
// cast: [{ actorId, actorName, roleName, isDouble, imageUrl }]
// onChange: (newCast) => void
function CastEditSection({ cast, onChange }) {
  // 배우 검색어
  const [actorQuery,   setActorQuery]   = useState('')
  // actors 컬렉션 검색 결과
  const [actorResults, setActorResults] = useState([])
  // 검색 중 여부
  const [searching,    setSearching]    = useState(false)
  // 검색 결과별 위키백과 이미지 { [actorId]: url | 'loading' | 'none' }
  const [wikiImages,   setWikiImages]   = useState({})

  // ── 검색어 변경 시 actors 컬렉션 클라이언트 필터 검색 ──
  useEffect(() => {
    if (!actorQuery.trim()) { setActorResults([]); return }
    if (!isFirebaseConfigured || !db) return
    setSearching(true)
    const keyword = actorQuery.trim().toLowerCase()
    getDocs(collection(db, 'actors'))
      .then(snap => {
        const filtered = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(a => a.name?.toLowerCase().includes(keyword))
          .slice(0, 8)
        setActorResults(filtered)
        setSearching(false)
      })
      .catch(err => { console.error('배우 검색 오류:', err); setSearching(false) })
  }, [actorQuery])

  // ── 검색 결과에서 사진 없는 배우 → 위키백과 자동 검색 ──
  useEffect(() => {
    for (const actor of actorResults) {
      if (actor.imageUrl || wikiImages[actor.id]) continue
      setWikiImages(prev => ({ ...prev, [actor.id]: 'loading' }))
      fetch(`https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(actor.name)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const url = data?.thumbnail?.source?.replace(/\/\d+px-/, '/300px-') ?? null
          setWikiImages(prev => ({ ...prev, [actor.id]: url || 'none' }))
        })
        .catch(() => setWikiImages(prev => ({ ...prev, [actor.id]: 'none' })))
    }
  }, [actorResults]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 기존 출연진의 역할명 / 더블캐스팅 수정 ──
  function updateMember(idx, field, value) {
    onChange(cast.map((c, i) => i === idx ? { ...c, [field]: value } : c))
  }

  // ── 검색 결과에서 배우 선택 → 태그로 추가 ──
  function addActor(actor) {
    if (cast.some(c => c.actorId === actor.id)) {
      alert(`「${actor.name}」은(는) 이미 추가된 배우입니다.`)
      return
    }
    const wikiImg  = wikiImages[actor.id]
    const imageUrl = actor.imageUrl ||
      (wikiImg && wikiImg !== 'loading' && wikiImg !== 'none' ? wikiImg : null)
    onChange([...cast, {
      actorId:   actor.id,
      actorName: actor.name,
      roleName:  '',
      isDouble:  false,
      imageUrl,
    }])
    setActorQuery('')
    setActorResults([])
  }

  // ── actors 컬렉션에 없는 경우 새 배우 Firestore에 생성 후 추가 ──
  async function addNewActor() {
    const name = actorQuery.trim()
    if (!name) return

    let actorId = ''
    if (isFirebaseConfigured && db) {
      try {
        const ref = await addDoc(collection(db, 'actors'), { name, createdAt: new Date() })
        actorId = ref.id
      } catch (err) {
        console.error('배우 생성 오류:', err)
      }
    }

    onChange([...cast, { actorId, actorName: name, roleName: '', isDouble: false, imageUrl: null }])
    setActorQuery('')
    setActorResults([])
  }

  // ── 출연진 태그 삭제 ──
  function removeMember(idx) {
    onChange(cast.filter((_, i) => i !== idx))
  }

  // ── 출연진 이름 → Firestore actors 이미지 맵 (배치 조회) ──
  const castCleanNames = cast.map(c => cleanActorName(c.actorName)).filter(Boolean)
  const actorImageMap  = useActorImageMap(castCleanNames)

  return (
    <div className="space-y-3">
      <label className={LABEL}>출연진</label>

      {/* 기존 출연진 태그 목록 */}
      {cast.length > 0 && (
        <div className="space-y-2">
          {cast.map((c, idx) => {
            const displayName = cleanActorName(c.actorName)
            const imgSrc      = toHttps(c.imageUrl || actorImageMap[displayName] || '')
            return (
            <div key={idx}
                 className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-xl p-2">
              {/* 배우 사진 */}
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-stone-200 shrink-0
                              flex items-center justify-center">
                {imgSrc ? (
                  <img src={imgSrc} alt={displayName}
                       className="w-full h-full object-cover"
                       onError={e => { e.target.style.display = 'none' }} />
                ) : (
                  <span className="text-base font-bold text-stone-400">{displayName?.[0]}</span>
                )}
              </div>
              {/* 배우 이름 */}
              <span className="text-sm font-semibold text-stone-800 w-16 shrink-0 truncate">
                {displayName}
              </span>
              {/* 역할명 입력칸 */}
              <input
                type="text"
                value={c.roleName ?? ''}
                onChange={e => updateMember(idx, 'roleName', e.target.value)}
                placeholder="역할명 입력"
                className="flex-1 text-xs border border-stone-200 rounded-lg px-2 py-1.5
                           focus:outline-none focus:ring-1 focus:ring-amber-300
                           placeholder:text-stone-300 bg-white"
              />
              {/* 더블캐스팅 체크박스 */}
              <label className={`flex items-center gap-1 text-xs shrink-0 cursor-pointer select-none
                                 px-2 py-1 rounded-full border transition-colors ${
                c.isDouble
                  ? 'bg-amber-100 border-amber-400 text-amber-700 font-semibold'
                  : 'border-stone-200 text-stone-400'
              }`}>
                <input
                  type="checkbox"
                  checked={c.isDouble ?? false}
                  onChange={e => updateMember(idx, 'isDouble', e.target.checked)}
                  className="w-3.5 h-3.5 accent-amber-500"
                />
                더블
              </label>
              {/* X 삭제 버튼 */}
              <button
                type="button"
                onClick={() => removeMember(idx)}
                className="text-stone-400 hover:text-red-500 transition-colors text-lg
                           leading-none font-bold shrink-0"
              >
                ×
              </button>
            </div>
            )
          })}
        </div>
      )}

      {/* 배우 추가 검색 입력창 */}
      <div className="relative">
        <input
          type="text"
          value={actorQuery}
          onChange={e => setActorQuery(e.target.value)}
          placeholder="배우 이름 검색 후 추가..."
          className={INPUT}
        />
        {searching && (
          <span className="absolute right-3 top-2.5 text-xs text-stone-400 pointer-events-none">
            검색 중...
          </span>
        )}
      </div>

      {/* 검색 결과 드롭다운 */}
      {actorResults.length > 0 && (
        <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100">
          {actorResults.map(actor => {
            const wikiImg = wikiImages[actor.id]
            const imgSrc  = toHttps(actor.imageUrl ||
              (wikiImg && wikiImg !== 'loading' && wikiImg !== 'none' ? wikiImg : null))
            const dupLabel = getDuplicateLabel(actor, actorResults)
            return (
              <button
                key={actor.id}
                type="button"
                onClick={() => addActor(actor)}
                className="w-full flex items-center gap-3 p-2.5 bg-white hover:bg-amber-50
                           text-left transition-colors"
              >
                {/* 배우 사진 (위키백과 자동 검색 포함) */}
                <div className="w-9 h-9 rounded-lg overflow-hidden bg-stone-100 shrink-0
                                flex items-center justify-center">
                  {wikiImg === 'loading' ? (
                    <span className="text-xs text-stone-400 animate-pulse">...</span>
                  ) : imgSrc ? (
                    <img src={imgSrc} alt={actor.name}
                         className="w-full h-full object-cover"
                         onError={e => { e.target.style.display = 'none' }} />
                  ) : (
                    <span className="font-bold text-stone-400">{actor.name?.[0]}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-stone-800">
                    {actor.name}
                    {dupLabel && (
                      <span className="ml-1.5 text-xs font-normal text-[#8FAF94] bg-[#EEF5EF] px-1.5 py-0.5 rounded">
                        {dupLabel}
                      </span>
                    )}
                  </p>
                  {actor.bio && !dupLabel && (
                    <p className="text-xs text-stone-400 truncate">{actor.bio}</p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* 검색 결과 없음: 새 배우로 직접 추가 옵션 */}
      {!searching && actorQuery.trim() && actorResults.length === 0 && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-stone-400 flex-1">
            「{actorQuery}」에 해당하는 배우가 없습니다.
          </p>
          <button
            type="button"
            onClick={addNewActor}
            className="px-3 py-1.5 text-xs font-semibold bg-stone-100 text-stone-700
                       rounded-lg hover:bg-stone-200 transition-colors shrink-0"
          >
            + 새 배우로 추가
          </button>
        </div>
      )}
    </div>
  )
}


// ── 티켓 링크 복수 입력 섹션 ─────────────────
// links: [{ site, customSite?, url }]
// onChange: (newLinks) => void
const TICKET_SITES = ['NOL티켓(인터파크)', '예스24', '멜론티켓', '티켓링크', '네이버', '타임티켓', '하나티켓', '쇼티켓', '직접입력']

function TicketLinksSection({ links, onChange }) {
  function updateLink(idx, field, value) {
    onChange(links.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }
  function addLink() {
    onChange([...links, { site: '', customSite: '', url: '' }])
  }
  function removeLink(idx) {
    onChange(links.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className={LABEL}>티켓 링크</label>
        <button
          type="button"
          onClick={addLink}
          className="text-xs font-semibold text-amber-600 hover:text-amber-500 transition-colors"
        >
          + 예매처 추가
        </button>
      </div>

      {links.length === 0 && (
        <p className="text-xs text-stone-400">
          티켓 링크가 없습니다. + 예매처 추가 버튼으로 입력하세요.
        </p>
      )}

      {links.map((link, idx) => (
        <div key={idx} className="flex gap-2 items-center flex-wrap">
          {/* 예매처 선택 */}
          <select
            value={TICKET_SITES.includes(link.site) ? link.site : (link.site ? '직접입력' : '')}
            onChange={e => {
              const val = e.target.value
              updateLink(idx, 'site', val)
              if (val !== '직접입력') updateLink(idx, 'customSite', '')
            }}
            className="w-28 shrink-0 border border-stone-200 rounded-lg px-2 py-2 text-xs bg-white
                       focus:outline-none focus:ring-1 focus:ring-amber-300 text-stone-600"
          >
            <option value="">예매처 선택</option>
            {TICKET_SITES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* 직접입력 시 사이트명 텍스트 입력 */}
          {link.site === '직접입력' && (
            <input
              type="text"
              value={link.customSite ?? ''}
              onChange={e => updateLink(idx, 'customSite', e.target.value)}
              placeholder="사이트명"
              className="w-24 shrink-0 border border-stone-200 rounded-lg px-2 py-2 text-xs bg-white
                         focus:outline-none focus:ring-1 focus:ring-amber-300 placeholder:text-stone-300"
            />
          )}

          {/* URL 입력 */}
          <input
            type="url"
            value={link.url}
            onChange={e => updateLink(idx, 'url', e.target.value)}
            placeholder="https://..."
            className="flex-1 min-w-[160px] border border-stone-200 rounded-lg px-2 py-2 text-xs bg-white
                       focus:outline-none focus:ring-1 focus:ring-amber-300 placeholder:text-stone-300"
          />

          {/* 삭제 버튼 */}
          <button
            type="button"
            onClick={() => removeLink(idx)}
            className="text-stone-400 hover:text-red-500 transition-colors text-lg leading-none
                       font-bold shrink-0"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}


// ── 나무위키 텍스트 파싱 ────────────────────────────
function parseNamuWiki(text) {
  const result = { synopsis: null, cast: null, dates: null, runtime: null, hasEncore: false }

  const lines = text.split('\n')

  // 공통: 줄 클린업 (링크·각주·편집태그·탭 제거)
  function cleanLine(raw) {
    return raw
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[편집\]/g, '')
      .replace(/\[\d+\]/g, '')
      .replace(/\[[A-Za-z]\]/g, '')
      .replace(/\{\{\{[^}]*\}\}\}/g, '')
      .replace(/\{\{\{|\}\}\}/g, '')
      .replace(/【[^】]*】/g, '')
      .replace(/^[\t ]+|[\t ]+$/g, '')
  }

  // ── 1. 시놉시스 ──
  // [편집] 포함된 줄 우선 (본문 헤더), 없으면 마지막 "시놉시스/줄거리" 줄 사용
  function findSynHeader(keyword) {
    const withEdit = lines.findIndex(l => l.includes(keyword) && l.includes('[편집]'))
    if (withEdit >= 0) return withEdit
    return lines.reduce((last, l, i) => l.includes(keyword) ? i : last, -1)
  }
  let synHeaderIdx = findSynHeader('시놉시스')
  if (synHeaderIdx < 0) synHeaderIdx = findSynHeader('줄거리')
  const synStartIdx = synHeaderIdx

  if (synStartIdx >= 0) {
    // 시놉시스 섹션 번호 파악 (예: "2. 시놉시스" → "2")
    const synSecNum = lines[synStartIdx].match(/^(\d+)\./)?.[1] ?? null
    // 하위섹션 패턴 (예: "2.1.")
    const synSubRe = synSecNum ? new RegExp(`^${synSecNum}\\.\\d+\\.`) : null

    const collected = []
    for (let i = synStartIdx + 1; i < lines.length; i++) {
      const raw = lines[i]
      if (/이\s*문서에\s*스포일러/i.test(raw)) break
      const cl = cleanLine(raw).replace(/\[스포\]/g, '')
      // 첫 번째 하위섹션(X.1. 등) 헤더 나오면 종료
      if (synSubRe && synSubRe.test(cl)) break
      if (/^\d+\./.test(cl)) break
      if (/구독자?|YouTube|youtu\.|TRAILER|http|www\.|다음에서\s*보기/i.test(cl)) continue
      if (/^[A-Z\s\[\]!?&|,.\-_'"]+$/.test(cl) && cl.trim().length > 0) continue
      collected.push(cl)
    }
    const syn = collected.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (syn.length > 10) result.synopsis = syn
  }

  // 시놉시스 실패 시 "개요" 섹션으로 fallback
  if (!result.synopsis) {
    const ovIdx = lines.findIndex(l => l.includes('개요'))
    if (ovIdx >= 0) {
      const collected = []
      for (let i = ovIdx + 1; i < lines.length; i++) {
        const raw = lines[i]
        if (/이\s*문서에\s*스포일러/i.test(raw)) break
        const cl = cleanLine(raw).replace(/\[스포\]/g, '')
        if (/^\d+\./.test(cl)) break
        if (/구독자?|YouTube|youtu\.|TRAILER|http|www\./i.test(cl)) continue
        collected.push(cl)
      }
      const ov = collected.join('\n').replace(/\n{3,}/g, '\n\n').trim()
      if (ov.length > 10) result.synopsis = ov
    }
  }

  // ── 2. 캐스트: "캐스트" 또는 "출연진" 섹션의 마지막 하위 섹션 ──
  const linesNoEdit   = lines.map(l => l.replace(/\[편집\]/g, ''))
  const textNoEdit    = linesNoEdit.join('\n')
  const allSubSections = [...textNoEdit.matchAll(/^(\d+)\.(\d+)\.\s+.+$/gm)]

  function sectionBlockSimple(headerIdx) {
    const collected = []
    let emptyRun = 0
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const noEdit = linesNoEdit[i]
      if (lines[i].includes('[편집]')) break
      if (/^\d+\./.test(noEdit.trim())) break
      if (noEdit.trim() === '') { emptyRun++; if (emptyRun >= 2) break } else emptyRun = 0
      collected.push(noEdit)
    }
    return collected.join('\n')
  }

  const stripLinks = s => s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
  const preClean   = s => stripLinks(s).replace(/\[\d+\]/g, '').replace(/\{\{\{[^}]*\}\}\}/g, '').replace(/\{\{\{|\}\}\}/g, '')

  const castHeaderIdx = lines.findIndex(l => /(?:캐스트|출연진|캐스팅)/.test(l))
  let castText = ''
  if (castHeaderIdx >= 0) {
    const castNum = lines[castHeaderIdx].match(/^(\d+)\./)?.[1] ?? null
    const castSubSecs = castNum ? allSubSections.filter(m => m[1] === castNum) : []
    if (castSubSecs.length > 0) {
      const last = castSubSecs[castSubSecs.length - 1]
      const startIdx = last.index + last[0].length
      const nextSub = textNoEdit.slice(startIdx).match(/^\d+\.\d+\.\s+/m)
      const nextTop = textNoEdit.slice(startIdx).match(/^\d+\.\s+\S/m)
      const endOff  = Math.min(nextSub?.index ?? Infinity, nextTop?.index ?? Infinity)
      castText = preClean(textNoEdit.slice(startIdx, endOff === Infinity ? undefined : startIdx + endOff))
    } else {
      // 하위섹션 없으면 섹션 헤더 바로 다음부터 다음 섹션까지 수집
      castText = preClean(sectionBlockSimple(castHeaderIdx))
    }
  } else if (allSubSections.length > 0) {
    // "YYYY년" 포함된 하위섹션 우선; 없으면 마지막 하위섹션
    const yearSubs = allSubSections.filter(m => /\d{4}년/.test(m[0]))
    const last = yearSubs.length > 0 ? yearSubs[yearSubs.length - 1] : allSubSections[allSubSections.length - 1]
    const startIdx = last.index + last[0].length
    const nextMatch = textNoEdit.slice(startIdx).match(/^\d+\.\d*\.?\s+\S/m)
    castText = preClean(textNoEdit.slice(startIdx, nextMatch ? startIdx + nextMatch.index : textNoEdit.length))
  }
  if (castText) {
    const castItems = []
    for (const line of castText.split('\n')) {
      // 날짜/공연 기간 줄 스킵 ("YYYY.MM.DD" 또는 "YYYY년" 포함)
      if (/\d{4}\.\d{1,2}\.\d{1,2}/.test(line) || /\d{4}년/.test(line)) continue
      const m = line.match(/^[*\s]*([^:\|\-\n]{1,25}?)\s*(?::\s*|\s*\|\s*|\s+-\s*)(.+)$/)
      if (!m) continue
      const roleName = m[1].replace(/^\s*[-*]\s*/, '').trim()
      if (!roleName || /^\d+$/.test(roleName)) continue
      const actors = m[2].trim().split(/[,，/]/)
        .map(a => a.replace(/\(.*?\)/g, '').trim())
        .filter(a => a.length >= 2 && a.length <= 12 && /^[가-힣a-zA-Z\s]+$/.test(a))
      if (actors.length === 0) continue
      const isDouble = actors.length >= 2
      for (const actorName of actors) castItems.push({ actorName, roleName, isDouble })
    }
    if (castItems.length > 0) result.cast = castItems
  }

  // ── 3. 공연장 ──
  const venueKeywords = /(?:극장|아트홀|아트센터|아트|씨어터|씨어타|theater|theatre|센터|공연\s*장소|공연장|NOL|유니플렉스|TOM(?!\s*\d)|KT&G|상상마당|자유극장|두산|연강홀|홍익대|예술의전당|CJ|토월|코엑스|아티움|국립|[가-힣]{1,10}[홀관당극])/i
  const SEASON_NAMES = '초연|재연|삼연|사연|오연|육연|칠연|팔연|구연|십연|트라이아웃|앵콜\\s*공연?|앵콜'
  const seasonPrefixRe = new RegExp(`(?:공연\\s*예정\\s*)?(?:${SEASON_NAMES})\\s*[:：]?\\s*`, 'gi')
  const seasonLinePrefixRe = new RegExp(`(?:공연\\s*예정\\s*)?(?:${SEASON_NAMES})\\s*[:：]`, 'i')

  // 시즌 이름 우선순위 (앞 = 낮음, 뒤 = 높음)
  const SEASON_ORDER = ['초연','재연','삼연','사연','오연','육연','칠연','팔연','구연','십연','트라이아웃','앵콜']
  function seasonRank(line) {
    let best = -1
    for (let r = 0; r < SEASON_ORDER.length; r++) {
      if (line.includes(SEASON_ORDER[r])) best = r
    }
    // 앵콜 공연 등 변형 처리
    if (/앵콜/.test(line)) best = Math.max(best, SEASON_ORDER.indexOf('앵콜'))
    return best
  }

  // ① 시즌 prefix("초연:", "재연:", "육연:" 등) 있는 줄 중 가장 높은 시즌 우선
  //    동순위면 텍스트 뒤쪽(마지막) 줄 사용
  const seasonVenueLines = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => seasonLinePrefixRe.test(l))

  if (seasonVenueLines.length > 0) {
    // rank 내림차순 → 줄 번호 내림차순 정렬
    const ranked = seasonVenueLines
      .map(entry => ({ ...entry, rank: seasonRank(entry.l) }))
      .sort((a, b) => b.rank !== a.rank ? b.rank - a.rank : b.i - a.i)

    for (const { l } of ranked) {
      const v = cleanLine(l)
        .replace(seasonPrefixRe, '')
        .replace(/공연\s*장소|공연장/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      // 날짜(4자리 숫자) 없고 텍스트 있으면 공연장명
      if (v && !/\d{4}/.test(v)) { result._venue = v; break }
    }
  }

  // ② prefix 없으면 "공연장"/"공연 장소" 포함 줄 + 다음 줄까지 탐색
  if (!result._venue) {
    const venueLineIdx = lines.findIndex(l => /공연\s*장소|공연장/.test(l))
    if (venueLineIdx >= 0) {
      for (let i = venueLineIdx; i <= Math.min(venueLineIdx + 3, lines.length - 1); i++) {
        const v = cleanLine(lines[i])
          .replace(/공연\s*장소|공연장/g, '')
          .replace(seasonPrefixRe, '')
          .replace(/\s+/g, ' ')
          .trim()
        if (v && venueKeywords.test(v)) { result._venue = v; break }
      }
    }
  }

  // ── 4. 기간 ──
  const normText = text.replace(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g, (_, y, m, d) => `${y}.${m}.${d}`)
  const dateRe   = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*[~～\-]\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/g
  const allDates = [...normText.matchAll(dateRe)]
  if (allDates.length > 0) {
    const last = allDates[allDates.length - 1]
    const pad  = n => String(n).padStart(2, '0')
    result.dates = {
      startDate: `${last[1]}-${pad(last[2])}-${pad(last[3])}`,
      endDate:   `${last[4]}-${pad(last[5])}-${pad(last[6])}`,
      venue:     result._venue ?? null,
    }
  }
  delete result._venue

  // 앵콜 감지: 공연장명 또는 텍스트 전체에 앵콜 키워드 존재 여부
  if (/앵콜/.test(text)) result.hasEncore = true

  // ── 5. 관람시간 ──
  // "관람시간" 줄 찾고, 그 줄 + 앞뒤 3줄 범위에서 숫자+분 탐색
  const timeLineIdx = lines.findIndex(l => /관람\s*시간|관람시간|러닝\s*타임|러닝타임|상연\s*시간/.test(l))
  let runtimeVal = null
  if (timeLineIdx >= 0) {
    for (let i = Math.max(0, timeLineIdx - 1); i <= Math.min(timeLineIdx + 3, lines.length - 1); i++) {
      const m = lines[i].replace(/\[\d+\]/g, '').match(/(\d{2,3})\s*분/)
      if (m) { runtimeVal = parseInt(m[1]); break }
    }
  }
  // fallback: 전체 텍스트에서 패턴 매칭
  if (!runtimeVal) {
    const fm =
      textNoEdit.match(/(?:관람\s*시간|관람시간|러닝\s*타임|러닝타임|상연\s*시간)\s*[:：]\s*(?:총\s*)?(\d{2,3})\s*분/) ??
      textNoEdit.match(/(\d{2,3})\s*분\s*(?:\[\d+\])?\s*\(?\s*인터미션/) ??
      textNoEdit.match(/총\s*(\d{2,3})\s*분/)
    if (fm) runtimeVal = parseInt(fm[1])
  }
  if (runtimeVal) result.runtime = runtimeVal

  return result
}

function NamuWikiModal({ onClose, onApply }) {
  const [text,    setText]    = useState('')
  const [parsed,  setParsed]  = useState(null)
  const [checked, setChecked] = useState({})

  function handleParse() {
    const result = parseNamuWiki(text)
    setParsed(result)
    // 값이 있는 항목만 기본 체크
    setChecked({
      synopsis: !!result.synopsis,
      cast:     !!result.cast,
      dates:    !!result.dates,
      runtime:  !!result.runtime,
    })
  }

  function handleApply() {
    const apply = {}
    if (checked.synopsis && parsed.synopsis) apply.synopsis = parsed.synopsis
    if (checked.cast     && parsed.cast)     apply.cast     = parsed.cast
    if (checked.dates    && parsed.dates)    apply.dates    = parsed.dates

    if (checked.runtime  && parsed.runtime)  apply.runtime  = parsed.runtime
    onApply(apply)
    onClose()
  }

  const toggle = key => setChecked(prev => ({ ...prev, [key]: !prev[key] }))

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <h3 className="font-bold text-stone-800">📋 나무위키 붙여넣기 파싱</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* 입력 영역 */}
          <div>
            <label className="text-xs font-semibold text-stone-500 mb-1 block">나무위키 문서 텍스트를 붙여넣으세요</label>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={10}
              placeholder="나무위키 페이지에서 전체 텍스트를 복사해서 붙여넣으세요..."
              className="w-full px-3 py-2 border border-stone-200 rounded-xl text-xs
                         font-mono focus:outline-none focus:ring-2 focus:ring-stone-300 resize-y"
            />
          </div>

          <button
            onClick={handleParse}
            disabled={!text.trim()}
            className="w-full py-2.5 bg-stone-800 text-white text-sm font-semibold
                       rounded-xl hover:bg-stone-700 disabled:opacity-40 transition-colors"
          >
            분석하기
          </button>

          {/* 파싱 결과 미리보기 */}
          {parsed && (
            <div className="space-y-2 border border-stone-100 rounded-xl p-4">
              <p className="text-xs font-bold text-stone-500 mb-3">파싱 결과 — 적용할 항목을 선택하세요</p>

              {parsed.hasEncore && (
                <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-300 rounded-lg px-3 py-2.5 mb-2">
                  <span className="text-base leading-none mt-0.5">⚠️</span>
                  <p className="text-xs text-yellow-800 font-medium">
                    앵콜 공연이 포함된 작품입니다. 공연장과 기간을 직접 확인해주세요.
                  </p>
                </div>
              )}

              {[
                { key: 'synopsis', label: '시놉시스',
                  preview: parsed.synopsis ? `${parsed.synopsis.slice(0, 100)}${parsed.synopsis.length > 100 ? '…' : ''}` : null },
                { key: 'cast', label: '캐스트',
                  preview: parsed.cast ? `${parsed.cast.length}명 발견 (${parsed.cast.slice(0, 3).map(c => c.actorName).join(', ')}${parsed.cast.length > 3 ? ' 외' : ''})` : null },
                { key: 'dates', label: '공연장/기간',
                  preview: parsed.dates ? `${parsed.dates.venue ?? '공연장 미확인'} / ${parsed.dates.startDate} ~ ${parsed.dates.endDate}` : null },
                { key: 'runtime', label: '관람시간',
                  preview: parsed.runtime ? `${parsed.runtime}분` : null },
              ].map(({ key, label, preview }) => (
                <label key={key} className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors
                                             ${preview ? 'hover:bg-stone-50' : 'opacity-40 cursor-default'}`}>
                  <input
                    type="checkbox"
                    checked={!!checked[key]}
                    disabled={!preview}
                    onChange={() => toggle(key)}
                    className="mt-0.5 accent-stone-700"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-stone-700">{preview ? '✅' : '❌'} {label}</span>
                    {preview
                      ? <p className="text-xs text-stone-500 mt-0.5 break-words">{preview}</p>
                      : <p className="text-xs text-stone-400 mt-0.5">
                          추출되지 않음
                          {key === 'synopsis' && (
                            <span className="block text-amber-600 mt-0.5">
                              나무위키 인용구 형태는 직접 복사해서 붙여넣어 주세요
                            </span>
                          )}
                        </p>}
                  </div>
                </label>
              ))}

              <button
                onClick={handleApply}
                disabled={!Object.values(checked).some(Boolean)}
                className="w-full mt-2 py-2.5 bg-amber-600 text-white text-sm font-semibold
                           rounded-xl hover:bg-amber-500 disabled:opacity-40 transition-colors"
              >
                선택 항목 폼에 적용
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 공연 정보 편집 폼 (대기 중 · 등록 완료 공통) ──
function ShowEditForm({ draft, onChangeDraft, onSave, onCancel }) {
  // sourceUrl에서 mt20id 파싱 (예: ...?pc=02&mt20id=PF12345)
  const mt20id = draft.sourceUrl
    ? new URLSearchParams(draft.sourceUrl.split('?')[1] ?? '').get('mt20id')
    : null

  function handleFetchSynopsis() {
    alert('시놉시스는 Python 스크립트로 수집하세요.\npython kopis.py --synopsis-only')
  }

  // 나무위키 파싱 모달
  const [namuOpen, setNamuOpen] = useState(false)

  function handleNamuApply({ synopsis, cast, dates, runtime }) {
    if (synopsis) onChangeDraft('synopsis', synopsis)
    if (cast)     setCast(cast.map(c => ({ actorId: '', actorName: c.actorName, roleName: c.roleName, isDouble: c.isDouble ?? false, imageUrl: null })))
    if (dates) {
      if (dates.startDate) onChangeDraft('startDate', dates.startDate)
      if (dates.endDate)   onChangeDraft('endDate',   dates.endDate)
      if (dates.venue)     onChangeDraft('venue',     dates.venue)
    }

    if (runtime) onChangeDraft('runtime', runtime)
  }

  // tags 배열 → 쉼표 문자열로 편집
  const [tagsStr, setTagsStr] = useState(
    Array.isArray(draft.tags) ? draft.tags.join(', ') : (draft.tags ?? '')
  )

  // 극 성격 태그 (다중 선택)
  const [showTags, setShowTags] = useState(
    Array.isArray(draft.showTags) ? draft.showTags : []
  )
  function toggleShowTag(tag) {
    setShowTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
  }

  // ── 출연진: draft.cast 배열에서 초기화 ──
  // 구조: [{ actorId, actorName, roleName, isDouble, imageUrl }]
  const [cast, setCast] = useState(
    Array.isArray(draft.cast) ? draft.cast.map(c => ({
      actorId:   c.actorId   ?? c.actorId  ?? '',
      actorName: c.actorName ?? '',
      roleName:  c.roleName  ?? c.role ?? '',    // 기존 'role' 필드도 수용
      isDouble:  c.isDouble  ?? false,
      imageUrl:  c.imageUrl  ?? c.actorImage ?? null,
    })) : []
  )

  // ── 티켓 링크: ticketLinks 배열 또는 ticketUrl 문자열에서 초기화 ──
  const [ticketLinks, setTicketLinks] = useState(() => {
    if (Array.isArray(draft.ticketLinks) && draft.ticketLinks.length > 0) {
      return draft.ticketLinks
    }
    // 기존 단일 ticketUrl 문자열을 배열로 변환
    if (draft.ticketUrl) {
      return [{ site: '', url: draft.ticketUrl }]
    }
    return []
  })

  // ── 포스터 URL (직접 수정 가능) ──
  const [posterUrl, setPosterUrl] = useState(draft.imageUrl ?? '')

  function handleSave() {
    const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean)
    // ticketUrl: 첫 번째 링크 URL을 단일값으로도 유지 (하위 호환)
    const ticketUrl = ticketLinks.find(l => l.url.trim())?.url ?? ''
    onSave({
      ...draft,
      tags,
      showTags,
      cast,
      ticketLinks,
      ticketUrl,      // 하위 호환 단일 URL
      imageUrl: posterUrl,
    })
  }

  return (
    <div className="space-y-4">
      {namuOpen && (
        <NamuWikiModal onClose={() => setNamuOpen(false)} onApply={handleNamuApply} />
      )}

      {/* ── 나무위키 버튼들 ── */}
      <div className="flex justify-end gap-2">
        {draft.title && (() => {
          const cleanTitle = (draft.title ?? '').replace(/\s*\[[^\]]*\]\s*/g, '').trim()
          const suffix = draft.genre === '연극' ? '(연극)' : '(뮤지컬)'
          const url = `https://namu.wiki/w/${encodeURIComponent(cleanTitle + suffix)}`
          return (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700
                         hover:bg-emerald-100 font-semibold transition-colors border border-emerald-200"
            >
              📋 나무위키에서 검색 →
            </a>
          )
        })()}
        <button
          type="button"
          onClick={() => setNamuOpen(true)}
          className="text-xs px-3 py-1.5 rounded-lg bg-sky-50 text-sky-700
                     hover:bg-sky-100 font-semibold transition-colors border border-sky-200"
        >
          📋 나무위키 붙여넣기
        </button>
      </div>

      {/* ── 기본 정보 그리드 ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={LABEL}>제목 *</label>
          <input
            value={draft.title ?? ''}
            onChange={e => onChangeDraft('title', e.target.value)}
            placeholder="공연 제목"
            className={INPUT}
          />
        </div>
        <div>
          <label className={LABEL}>부제목</label>
          <input
            value={draft.subtitle ?? ''}
            onChange={e => onChangeDraft('subtitle', e.target.value)}
            placeholder="영문 제목 또는 부제"
            className={INPUT}
          />
        </div>
        <div>
          <label className={LABEL}>장르 *</label>
          <select
            value={draft.genre ?? ''}
            onChange={e => onChangeDraft('genre', e.target.value)}
            className={INPUT}
          >
            <option value="">장르 선택</option>
            {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL}>공연장 *</label>
          <input
            value={draft.venue ?? ''}
            onChange={e => onChangeDraft('venue', e.target.value)}
            placeholder="예: 충무아트센터 대극장"
            className={INPUT}
          />
        </div>
        <div>
          <label className={LABEL}>주소</label>
          <input
            value={draft.address ?? ''}
            onChange={e => onChangeDraft('address', e.target.value)}
            placeholder="예: 서울 중구 퇴계로 387"
            className={INPUT}
          />
        </div>
        <div>
          <label className={LABEL}>시작일 *</label>
          <input
            type="date"
            value={draft.startDate ?? ''}
            onChange={e => onChangeDraft('startDate', e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label className={LABEL}>종료일 *</label>
          <input
            type="date"
            value={draft.endDate ?? ''}
            onChange={e => onChangeDraft('endDate', e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label className={LABEL}>상연시간 (분)</label>
          <input
            type="number"
            value={draft.runtime ?? ''}
            onChange={e => onChangeDraft('runtime', Number(e.target.value))}
            placeholder="예: 180"
            className={INPUT}
          />
        </div>
        <div>
          <label className={LABEL}>출처</label>
          <input
            value={draft.source ?? ''}
            onChange={e => onChangeDraft('source', e.target.value)}
            placeholder="예: 뮤지컬DB, 수동입력"
            className={INPUT}
          />
        </div>
      </div>

      {/* ── 시놉시스 ── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={LABEL}>시놉시스</label>
          {mt20id && (
            <button
              type="button"
              onClick={handleFetchSynopsis}
              className="text-xs px-2.5 py-1 rounded-lg bg-stone-100 text-stone-600
                         hover:bg-stone-200 transition-colors"
            >
              KOPIS 시놉시스 안내
            </button>
          )}
        </div>
        <textarea
          value={draft.synopsis ?? ''}
          onChange={e => onChangeDraft('synopsis', e.target.value)}
          rows={3}
          placeholder="공연 줄거리 및 소개"
          className={`${INPUT} resize-none`}
        />
      </div>

      {/* ── 태그 ── */}
      <div>
        <label className={LABEL}>태그 (쉼표로 구분)</label>
        <input
          value={tagsStr}
          onChange={e => setTagsStr(e.target.value)}
          placeholder="대형뮤지컬, 명작, 가족"
          className={INPUT}
        />
      </div>

      {/* ── 극 성격 태그 ── */}
      <div>
        <label className={LABEL}>극 성격 태그</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {SHOW_TAGS.map(tag => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleShowTag(tag)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                showTags.includes(tag)
                  ? 'bg-[#2C1810] text-white border-[#2C1810]'
                  : 'bg-white border-stone-300 text-stone-600 hover:border-stone-500'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* ── 포스터 이미지 URL + 미리보기 ── */}
      <div>
        <label className={LABEL}>포스터 이미지 URL</label>
        <div className="flex gap-3 items-start">
          {/* URL 수정 입력창 */}
          <input
            type="url"
            value={posterUrl}
            onChange={e => setPosterUrl(e.target.value)}
            placeholder="https://..."
            className={`${INPUT} flex-1`}
          />
          {/* 미리보기 (URL 있을 때만) */}
          {posterUrl && (
            <div className="w-16 h-20 rounded-lg overflow-hidden bg-stone-100 shrink-0 border border-stone-200">
              <img
                src={toHttps(posterUrl)}
                alt="포스터 미리보기"
                className="w-full h-full object-cover"
                onError={e => { e.target.style.display = 'none' }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── 티켓 링크 복수 입력 ── */}
      <TicketLinksSection links={ticketLinks} onChange={setTicketLinks} />

      {/* ── 출연진 편집 ── */}
      <div className="border-t border-stone-100 pt-4">
        <CastEditSection cast={cast} onChange={setCast} />
      </div>

      {/* ── 저장 / 취소 버튼 ── */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          className="flex-1 sm:flex-none px-8 py-2.5 bg-amber-600 text-white text-sm
                     font-semibold rounded-lg hover:bg-amber-500 transition-colors"
        >
          저장하기
        </button>
        <button
          onClick={onCancel}
          className="flex-1 sm:flex-none px-8 py-2.5 border border-stone-300 text-stone-600
                     text-sm rounded-lg hover:bg-stone-50 transition-colors"
        >
          취소
        </button>
      </div>
    </div>
  )
}


// ── 대기 중 공연 행 (compact list) ──────────────
// 각 행: 체크박스 | 포스터 | 장르+공연명 | 공연장 | 기간 | 캐스트 수 | 버튼
function PendingRow({ show, selected, onSelect, onEdit, onApprove, onReject, riskLevel = 'ok' }) {
  const genreColor = GENRE_COLOR[show.genre] ?? GENRE_COLOR['기타']
  const castCount  = Array.isArray(show.cast) ? show.cast.length : 0

  // 날짜를 "3.28" 짧은 형식으로
  function shortDate(d) {
    if (!d) return '?'
    const [, m, day] = d.split('-')
    return `${parseInt(m)}.${parseInt(day)}`
  }

  return (
    <div
      className={`flex items-center gap-2 px-3 border-b border-stone-100 transition-colors
                  ${selected ? 'bg-amber-50' : 'bg-white hover:bg-stone-50'}`}
      style={{ minHeight: 80 }}
    >
      {/* 체크박스 */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onSelect}
        className="w-4 h-4 accent-amber-500 shrink-0"
        onClick={e => e.stopPropagation()}
      />

      {/* 포스터 썸네일 50×70 */}
      <div className="w-[50px] h-[70px] shrink-0 rounded-lg overflow-hidden bg-stone-100
                      flex items-center justify-center my-1.5">
        {show.imageUrl ? (
          <img
            src={toHttps(show.imageUrl)}
            alt={show.title}
            className="w-full h-full object-cover"
            onError={e => { e.target.style.display = 'none' }}
            loading="lazy"
          />
        ) : (
          <span className="text-stone-300 text-[10px] text-center px-1 leading-tight">
            {show.title?.slice(0, 5)}
          </span>
        )}
      </div>

      {/* 장르 뱃지 + 공연명 */}
      <div className="flex-1 min-w-0 py-1">
        <div className="flex items-center gap-1 mb-0.5 flex-wrap">
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${genreColor}`}>
            {show.genre || '미정'}
          </span>
          {riskLevel !== 'ok' && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${RISK_BADGE[riskLevel].cls}`}>
              {RISK_BADGE[riskLevel].emoji}
            </span>
          )}
        </div>
        <p className="text-sm font-semibold text-stone-900 truncate leading-snug">
          {show.title}
        </p>
        {show.subtitle && (
          <p className="text-xs text-stone-400 truncate">{show.subtitle}</p>
        )}
      </div>

      {/* 공연장 (md 이상에서 표시) */}
      <div className="hidden md:block w-36 shrink-0 text-xs text-stone-500 truncate">
        {show.venue || '-'}
      </div>

      {/* 기간 (lg 이상에서 표시) */}
      <div className="hidden lg:block w-28 shrink-0 text-xs text-stone-400 text-center">
        {shortDate(show.startDate)}~{shortDate(show.endDate)}
      </div>

      {/* 캐스트 수 (sm 이상) */}
      <div className="hidden sm:flex w-12 shrink-0 justify-center">
        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
          castCount > 0
            ? 'bg-sky-100 text-sky-700'
            : 'bg-stone-100 text-stone-400'
        }`}>
          {castCount > 0 ? `${castCount}명` : '-'}
        </span>
      </div>

      {/* 액션 버튼 */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onApprove(show.id)}
          className="px-2.5 py-1.5 text-xs font-semibold text-emerald-700
                     bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
        >
          승인
        </button>
        <button
          onClick={() => onEdit(show)}
          className="px-2.5 py-1.5 text-xs font-semibold text-stone-600
                     bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
        >
          수정
        </button>
        <button
          onClick={() => onReject(show.id)}
          className="px-2.5 py-1.5 text-xs font-semibold text-red-600
                     bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
        >
          거절
        </button>
      </div>
    </div>
  )
}


// ── 수정 사이드 패널 (오른쪽 슬라이드인) ──────────
// show: 편집 대상 공연 객체
// onSave: (id, data) => Promise
// onClose: () => void
function PendingEditPanel({ show, onSave, onClose }) {
  const [draft, setDraft] = useState({ ...show })
  const panelRef = useRef(null)

  function handleChangeDraft(key, value) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave(data) {
    await onSave(show.id, data)
    onClose()
  }

  // ESC 키로 패널 닫기
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 패널 열릴 때 body 스크롤 잠금
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <>
      {/* 뒤 배경 오버레이 — 클릭하면 닫힘 */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />

      {/* 사이드 패널 본체 */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col
                   w-full sm:w-[500px] bg-white shadow-2xl"
      >
        {/* 패널 헤더 */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-stone-100 shrink-0">
          <div className="min-w-0 pr-2">
            <h2 className="font-semibold text-stone-900 text-base leading-snug line-clamp-2">
              {show.title}
            </h2>
            <p className="text-xs text-stone-400 mt-0.5">공연 정보 수정</p>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 transition-colors
                       text-2xl font-bold leading-none shrink-0 p-1"
          >
            ×
          </button>
        </div>

        {/* 스크롤 가능한 폼 영역 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <ShowEditForm
            draft={draft}
            onChangeDraft={handleChangeDraft}
            onSave={handleSave}
            onCancel={onClose}
          />
        </div>
      </div>
    </>
  )
}


// ── 등록 완료 공연 — 한 줄 리스트 행 ─────────────
function ShowCard({ show, onUpdate, onDelete, onRevert }) {
  const [editing,  setEditing]  = useState(false)
  const [checked,  setChecked]  = useState(false)
  const [draft,    setDraft]    = useState({ ...show })

  function handleChangeDraft(key, value) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }
  async function handleSave(data) {
    await onUpdate(show.id, data)
    setEditing(false)
  }
  function handleCancel() {
    setDraft({ ...show })
    setEditing(false)
  }

  const genreColor = GENRE_COLOR[show.genre] ?? GENRE_COLOR['기타']
  const posterSrc  = show.imageUrl || show.posterUrl || ''
  const castCount  = show.cast?.length ?? 0

  // ── 편집 모드: 행 아래 펼쳐지는 폼 ──
  if (editing) {
    return (
      <li className="bg-white rounded-xl border-2 border-amber-300 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-2.5 border-b border-amber-100">
          <div className="w-8 h-11 rounded-md overflow-hidden bg-stone-100 shrink-0">
            {posterSrc
              ? <img src={toHttps(posterSrc)} alt={show.title} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-base">🎭</div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-stone-900 text-sm truncate">{show.title}</p>
            <p className="text-xs text-stone-400 truncate">{show.venue}</p>
          </div>
          <span className="text-xs text-amber-600 font-medium">수정 중</span>
        </div>
        <div className="p-4">
          <ShowEditForm
            draft={draft}
            onChangeDraft={handleChangeDraft}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        </div>
      </li>
    )
  }

  // ── 보기 모드: 한 줄 ──
  return (
    <li className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-stone-100
                   hover:border-stone-200 hover:bg-stone-50 transition-colors group">

      {/* 체크박스 */}
      <input
        type="checkbox"
        checked={checked}
        onChange={e => setChecked(e.target.checked)}
        className="w-4 h-4 rounded border-stone-300 accent-[#8FAF94] shrink-0 cursor-pointer"
      />

      {/* 포스터 썸네일 */}
      <div className="w-8 h-11 rounded-md overflow-hidden bg-stone-100 shrink-0">
        {posterSrc
          ? <img src={toHttps(posterSrc)} alt={show.title} className="w-full h-full object-cover"
                 onError={e => { e.target.style.display = 'none' }} />
          : <div className="w-full h-full flex items-center justify-center text-base">🎭</div>
        }
      </div>

      {/* 장르 뱃지 */}
      <span className={`hidden sm:inline-block text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 ${genreColor}`}>
        {show.genre || '?'}
      </span>

      {/* 제목 + 공연장 */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-stone-900 text-sm truncate leading-tight">{show.title}</p>
        <p className="text-xs text-stone-400 truncate">{show.venue}</p>
      </div>

      {/* 배우 수 */}
      {castCount > 0 && (
        <span className="hidden sm:block text-xs text-stone-400 shrink-0">
          배우 {castCount}명
        </span>
      )}

      {/* 버튼 */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setEditing(true)}
          className="px-2.5 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-100
                     rounded-lg transition-colors"
        >
          수정
        </button>
        <button
          onClick={() => onRevert(show.id)}
          className="px-2.5 py-1.5 text-xs font-semibold text-amber-600 hover:bg-amber-50
                     rounded-lg transition-colors"
        >
          반려
        </button>
        <button
          onClick={() => onDelete(show.id)}
          className="px-2.5 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50
                     rounded-lg transition-colors"
        >
          삭제
        </button>
      </div>
    </li>
  )
}


// ── 출연진 입력 섹션 ──────────────────────────
// cast: [{ actorId, actorName, actorImage, role }]
// onChange: (newCast) => void
// ── 드래그 가능한 출연진 태그 ─────────────────────
function SortableCastItem({ c, onRemove, imageFromMap }) {
  // actorId가 없는 경우 actorName을 fallback id로 사용
  const dndId = c.actorId || `name_${c.actorName}`
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dndId })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`flex items-center gap-1.5 border rounded-full pl-1 pr-2 py-1 text-xs select-none
                  ${isDragging ? 'bg-[#F5F3F0] border-[#C8D8CA] shadow-md opacity-90 z-10' : 'bg-amber-50 border-amber-200'}`}
    >
      {/* 드래그 핸들 */}
      <span
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-[#C8D8CA] hover:text-stone-400 px-0.5 text-base leading-none"
        title="드래그하여 순서 변경"
      >
        ⠿
      </span>
      {/* 썸네일 */}
      {(() => {
        const displayName = cleanActorName(c.actorName)
        const imgSrc = toHttps(c.actorImage || imageFromMap || '')
        return imgSrc ? (
          <img src={imgSrc} alt={displayName} className="w-6 h-6 rounded-full object-cover shrink-0"
               onError={e => { e.target.style.display = 'none' }} />
        ) : (
          <div className="w-6 h-6 rounded-full bg-amber-200 shrink-0 flex items-center justify-center font-bold text-amber-700">
            {displayName?.[0]}
          </div>
        )
      })()}
      <span className="font-medium text-stone-800">{cleanActorName(c.actorName)}</span>
      {c.role && <span className="text-stone-400">({c.role})</span>}
      <button
        type="button"
        onClick={() => onRemove(c.actorId)}
        className="ml-0.5 text-stone-400 hover:text-red-500 transition-colors font-bold leading-none"
      >
        ×
      </button>
    </div>
  )
}

function ActorCastSection({ cast, onChange }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  function handleDragEnd(event) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIdx = cast.findIndex(c => c.actorId === active.id)
      const newIdx = cast.findIndex(c => c.actorId === over.id)
      onChange(arrayMove(cast, oldIdx, newIdx))
    }
  }

  // 검색어
  const [query,      setQuery]      = useState('')
  // actors 컬렉션 검색 결과
  const [results,    setResults]    = useState([])
  // 검색 중 여부
  const [searching,  setSearching]  = useState(false)
  // 결과별 위키백과 이미지 { [actorId]: url | 'loading' | 'none' }
  const [wikiImages, setWikiImages] = useState({})
  // 결과별 역할명 임시 입력 { [actorId]: string }
  const [roleInputs, setRoleInputs] = useState({})

  // ── 검색어 변경 시 actors 컬렉션 클라이언트 필터 검색 ──
  // Firestore는 full-text search 미지원이므로 getDocs 후 클라이언트에서 필터
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    if (!isFirebaseConfigured || !db) return

    setSearching(true)
    const keyword = query.trim().toLowerCase()

    getDocs(collection(db, 'actors'))
      .then(snap => {
        const filtered = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(a => a.name && a.name.toLowerCase().includes(keyword))
          .slice(0, 8) // 최대 8명까지 표시
        setResults(filtered)
        setSearching(false)
      })
      .catch(err => {
        console.error('배우 검색 오류:', err)
        setSearching(false)
      })
  }, [query])

  // ── 검색 결과에서 이미지 없는 배우 → 위키백과 자동 검색 ──
  useEffect(() => {
    for (const actor of results) {
      if (actor.imageUrl) continue            // 이미 DB 사진 있음
      if (wikiImages[actor.id]) continue      // 이미 위키 검색 완료/진행 중

      // 위키백과 검색 시작 표시
      setWikiImages(prev => ({ ...prev, [actor.id]: 'loading' }))

      fetch(`https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(actor.name)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          // 해상도를 300px로 통일
          const url = data?.thumbnail?.source?.replace(/\/\d+px-/, '/300px-') ?? null
          setWikiImages(prev => ({ ...prev, [actor.id]: url || 'none' }))
        })
        .catch(() => {
          setWikiImages(prev => ({ ...prev, [actor.id]: 'none' }))
        })
    }
  }, [results]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 배우 확정(✅ 맞음): 출연진에 추가 ──
  function confirmActor(actor) {
    const role      = roleInputs[actor.id] ?? ''
    const wikiImg   = wikiImages[actor.id]
    // DB 사진 우선, 없으면 위키 사진, 그것도 없으면 null
    const actorImage = actor.imageUrl ||
      (wikiImg && wikiImg !== 'loading' && wikiImg !== 'none' ? wikiImg : null)

    // 이미 추가된 배우면 중복 방지
    if (cast.some(c => c.actorId === actor.id)) {
      alert(`「${actor.name}」은(는) 이미 추가된 배우입니다.`)
      return
    }

    onChange([...cast, { actorId: actor.id, actorName: actor.name, actorImage, role }])
    // 검색 초기화
    setQuery('')
    setResults([])
    setRoleInputs({})
  }

  // ── 배우 제외(❌ 다른 배우): 검색 결과에서 제거 ──
  function dismissActor(actorId) {
    setResults(prev => prev.filter(a => a.id !== actorId))
  }

  // ── 출연진 태그에서 삭제 ──
  function removeCast(actorId) {
    onChange(cast.filter(c => c.actorId !== actorId))
  }

  // ── 출연진 이름 → Firestore actors 이미지 맵 (배치 조회) ──
  const castCleanNames = cast.map(c => cleanActorName(c.actorName)).filter(Boolean)
  const actorImageMap  = useActorImageMap(castCleanNames)

  return (
    <div className="space-y-3">
      <label className={LABEL}>출연진</label>

      {/* 이미 추가된 배우 태그 목록 (드래그로 순서 변경 가능) */}
      {cast.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={cast.map(c => c.actorId || `name_${c.actorName}`)} strategy={horizontalListSortingStrategy}>
            <div className="flex flex-wrap gap-2">
              {cast.map(c => (
                <SortableCastItem
                  key={c.actorId}
                  c={c}
                  onRemove={removeCast}
                  imageFromMap={actorImageMap[cleanActorName(c.actorName)]}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* 배우 이름 검색 입력창 */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="배우 이름 검색 (actors 컬렉션에서 검색)..."
          className={INPUT}
        />
        {searching && (
          <span className="absolute right-3 top-2.5 text-xs text-stone-400 pointer-events-none">
            검색 중...
          </span>
        )}
      </div>

      {/* 검색 결과 목록 */}
      {results.length > 0 && (
        <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100">
          {results.map(actor => {
            const wikiImg    = wikiImages[actor.id]
            const wikiLoading = !actor.imageUrl && wikiImg === 'loading'
            // 표시할 사진: DB 사진 → 위키 사진 → null
            const imgSrc     = actor.imageUrl ||
              (wikiImg && wikiImg !== 'loading' && wikiImg !== 'none' ? wikiImg : null)

            return (
              <div key={actor.id} className="flex items-start gap-3 p-3 bg-white hover:bg-stone-50">
                {/* 배우 사진 (동명이인 확인용) */}
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-stone-100 shrink-0
                                flex items-center justify-center">
                  {wikiLoading ? (
                    // 위키백과 사진 로딩 중
                    <span className="text-xs text-stone-400 animate-pulse">로딩</span>
                  ) : imgSrc ? (
                    <img src={imgSrc} alt={actor.name}
                         className="w-full h-full object-cover"
                         onError={e => { e.target.style.display = 'none' }} />
                  ) : (
                    // 사진 없음: 이름 첫 글자
                    <span className="text-xl text-stone-400">{actor.name?.[0]}</span>
                  )}
                </div>

                {/* 배우 정보 + 역할 입력 + 확인 버튼 */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-800">
                    {actor.name}
                    {(() => {
                      const dupLabel = getDuplicateLabel(actor, results)
                      return dupLabel ? (
                        <span className="ml-1.5 text-xs font-normal text-[#8FAF94] bg-[#EEF5EF] px-1.5 py-0.5 rounded">
                          {dupLabel}
                        </span>
                      ) : null
                    })()}
                  </p>
                  {/* bio는 dupLabel 없을 때만 표시 (dupLabel이 bio 기반이면 중복) */}
                  {actor.bio && !getDuplicateLabel(actor, results) && (
                    <p className="text-xs text-stone-400 line-clamp-1">{actor.bio}</p>
                  )}
                  {/* 위키백과 사진 출처 표시 */}
                  {!actor.imageUrl && imgSrc && (
                    <p className="text-xs text-blue-400">📸 위키백과 사진</p>
                  )}

                  {/* 역할명 입력 */}
                  <input
                    type="text"
                    value={roleInputs[actor.id] ?? ''}
                    onChange={e => setRoleInputs(prev => ({ ...prev, [actor.id]: e.target.value }))}
                    placeholder="역할명 입력 (선택사항)"
                    className="mt-1.5 w-full text-xs border border-stone-200 rounded-lg
                               px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-300
                               placeholder:text-stone-300"
                  />

                  {/* 동명이인 확인 버튼 */}
                  <p className="text-xs text-stone-500 mt-1.5 mb-1">이 배우가 맞나요?</p>
                  <div className="flex gap-1.5">
                    {/* ✅ 맞음: 출연진에 추가 */}
                    <button
                      type="button"
                      onClick={() => confirmActor(actor)}
                      className="px-2.5 py-1 text-xs font-semibold bg-emerald-600 text-white
                                 rounded-lg hover:bg-emerald-500 transition-colors"
                    >
                      ✅ 맞음
                    </button>
                    {/* ❌ 다른 배우: 이 결과 제거 → 다음 결과 표시 */}
                    <button
                      type="button"
                      onClick={() => dismissActor(actor.id)}
                      className="px-2.5 py-1 text-xs font-semibold bg-stone-100 text-stone-600
                                 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      ❌ 다른 배우
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 검색했는데 결과 없음 */}
      {!searching && query.trim() && results.length === 0 && (
        <p className="text-xs text-stone-400 px-1">
          「{query}」에 해당하는 배우가 없습니다. 배우 관리 탭에서 먼저 등록하세요.
        </p>
      )}
    </div>
  )
}


// ════════════════════════════════════════════════
// 대기 중 탭 필터 헬퍼
// ════════════════════════════════════════════════

// ── 서울 중심부 구 목록 ──
const SEOUL_CENTER_GU = ['종로구', '중구', '마포구', '강남구', '서초구', '용산구', '성동구', '광진구']
// ── 서울 외곽 구 목록 ──
const SEOUL_OUTER_GU  = ['도봉구', '노원구', '강북구', '은평구', '중랑구', '동대문구', '성북구',
                         '강서구', '양천구', '금천구', '구로구', '동작구', '관악구', '강동구', '송파구']

// 공연 기간(일수) 계산
function getDurationDays(show) {
  if (!show.startDate || !show.endDate) return null
  const start = new Date(show.startDate)
  const end   = new Date(show.endDate)
  if (isNaN(start) || isNaN(end)) return null
  return Math.round((end - start) / (1000 * 60 * 60 * 24))
}

// 기간 카테고리 분류: short(7일↓) / medium(8~30일) / long(31일↑) / unknown
function getDurationCategory(days) {
  if (days === null) return 'unknown'
  if (days <= 7)    return 'short'
  if (days <= 30)   return 'medium'
  return 'long'
}

// 지역 카테고리 분류
function getRegionCategory(show) {
  const addr  = (show.address ?? '').toLowerCase()
  const venue = (show.venue   ?? '').toLowerCase()
  const tags  = show.tags ?? []
  const text  = addr + ' ' + venue

  // 1. 대학로: KOPIS 태그 또는 주소·장소에 '대학로' 포함
  if (tags.includes('대학로') || text.includes('대학로')) return 'daehakro'

  // 2. 서울 여부 (주소에 '서울' 포함)
  const isSeoul = addr.includes('서울') || venue.includes('서울')
  if (!isSeoul) return 'province'

  // 3. 서울 중심부 (종로/중구/마포/강남 등)
  if (SEOUL_CENTER_GU.some(gu => addr.includes(gu))) return 'seoul_center'

  // 4. 서울 외곽 (도봉/노원/강북/은평 등)
  if (SEOUL_OUTER_GU.some(gu => addr.includes(gu))) return 'seoul_outer'

  // 5. 서울이지만 구 정보 없음 → 중심으로 간주
  return 'seoul_center'
}

// 자동 위험도 계산
// 🔴 단기 + 지방 → danger
// 🟡 단기 또는 지방 → warning
// 🟢 그 외 → ok
function getRiskLevel(show) {
  const days   = getDurationDays(show)
  const dur    = getDurationCategory(days)
  const reg    = getRegionCategory(show)
  const isShort = dur === 'short'
  const isProv  = reg === 'province'
  if (isShort && isProv) return 'danger'
  if (isShort || isProv) return 'warning'
  return 'ok'
}

// 위험도 뱃지 스타일
const RISK_BADGE = {
  danger:  { emoji: '🔴', label: '검토 필요', cls: 'bg-red-50 text-red-700 border border-red-200' },
  warning: { emoji: '🟡', label: '확인 필요', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  ok:      { emoji: '🟢', label: '정상',      cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
}


// ── 검토 대기 배우 사진 카드 ────────────────────────────────────────
// pending: { id, actorId, actorName, imageUrl, profileUrl, reason, candidates }
// onApprove: (pending, imageUrl) => Promise
// onReject:  (pendingId) => Promise
function PendingActorCard({ pending, currentShows = [], onApprove, onReject }) {
  // 현재 선택된 사진 URL (candidates 중 선택 또는 직접 입력)
  const [selectedUrl, setSelectedUrl] = useState(pending.imageUrl ?? '')
  // 직접 URL 입력 모드 여부
  const [customMode,  setCustomMode]  = useState(false)
  // 직접 입력 URL
  const [customUrl,   setCustomUrl]   = useState('')
  // 승인/거절 진행 중 여부
  const [approving,   setApproving]   = useState(false)
  const [rejecting,   setRejecting]   = useState(false)

  // 표시할 최종 URL: 직접 입력 모드면 customUrl, 아니면 selectedUrl
  const displayUrl = customMode ? customUrl : selectedUrl

  async function handleApprove() {
    const url = displayUrl.trim()
    if (!url) { alert('사진 URL이 없습니다.'); return }
    setApproving(true)
    await onApprove(pending, url)
    setApproving(false)
  }

  async function handleReject() {
    setRejecting(true)
    await onReject(pending.id)
    setRejecting(false)
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4">
      <div className="flex items-start gap-4">
        {/* 수집된 사진 미리보기 */}
        <div className="w-20 h-24 rounded-xl overflow-hidden bg-stone-100 shrink-0
                        flex items-center justify-center border border-stone-200">
          {displayUrl ? (
            <img src={toHttps(displayUrl)} alt={pending.actorName}
                 className="w-full h-full object-cover"
                 onError={e => { e.target.style.display = 'none' }} />
          ) : (
            <span className="text-3xl text-stone-300">{pending.actorName?.[0]}</span>
          )}
        </div>

        {/* 배우 정보 + 버튼 */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* 배우 이름 + 검토 사유 + 플레이DB 링크 */}
          <div>
            <p className="font-semibold text-stone-900">{pending.actorName}</p>
            {currentShows.length > 0 && (
              <p className="text-xs text-stone-400 mt-0.5">
                {currentShows.join(' · ')}
              </p>
            )}
            <p className="text-xs text-amber-600 mt-0.5">⚠️ {pending.reason}</p>
            {pending.profileUrl && (
              <a href={pending.profileUrl} target="_blank" rel="noopener noreferrer"
                 className="text-xs text-blue-500 hover:underline">
                플레이DB 프로필 보기 →
              </a>
            )}
          </div>

          {/* 동명이인 등 후보 여러 명일 때 선택 버튼 */}
          {(pending.candidates?.length ?? 0) > 1 && (
            <div className="flex gap-2 flex-wrap">
              {pending.candidates.map((c, i) => (
                <div key={i} className="flex flex-col items-start">
                  <button
                    onClick={() => { setSelectedUrl(c.imageUrl); setCustomMode(false) }}
                    className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                      !customMode && selectedUrl === c.imageUrl
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    {c.name} ({i + 1}순위)
                  </button>
                  {c.shows?.length > 0 && (
                    <p className="text-xs text-stone-400 mt-0.5 pl-1">
                      {c.shows.slice(0, 2).join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 직접 URL 입력 모드 */}
          {customMode && (
            <input
              type="url"
              value={customUrl}
              onChange={e => setCustomUrl(e.target.value)}
              placeholder="https://..."
              autoFocus
              className={`${INPUT} text-xs`}
            />
          )}

          {/* ✅ 맞음 / ❌ 아님 / 🔍 URL 직접 입력 버튼 */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleApprove}
              disabled={approving || !displayUrl.trim()}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white
                         rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors"
            >
              {approving ? '저장 중...' : '✅ 맞음'}
            </button>
            <button
              onClick={handleReject}
              disabled={rejecting}
              className="px-3 py-1.5 text-xs font-semibold bg-red-50 text-red-600
                         rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
            >
              {rejecting ? '삭제 중...' : '❌ 아님'}
            </button>
            <button
              onClick={() => { setCustomMode(v => !v); setCustomUrl('') }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                customMode
                  ? 'bg-blue-600 text-white hover:bg-blue-500'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              🔍 URL 직접 입력
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


// ── 메인 컴포넌트 ─────────────────────────────
export default function AdminPage() {
  const [authed,      setAuthed]      = useState(false)
  const [password,    setPassword]    = useState('')
  const [tab,         setTab]         = useState('pending')
  const [pendingList, setPendingList] = useState([])
  const [showsList,   setShowsList]   = useState([])
  const [selected,    setSelected]    = useState(new Set())
  const [dataLoading, setDataLoading] = useState(false)

  // ── 등록 완료 탭 필터/검색/페이지 상태 ──────────
  const [showsSearch,      setShowsSearch]      = useState('')
  const [showsFilterGenre, setShowsFilterGenre] = useState('all')
  const [showsSortBy,      setShowsSortBy]      = useState('collectedAt_desc')
  const [showsPage,        setShowsPage]        = useState(0)

  // ── 태그 제안 탭 상태 ──────────────────────────
  const [suggestionsList, setSuggestionsList] = useState([])

  // ── 대기 중 탭 필터 상태 ──────────────────────
  // 기간 필터: all / short(7일↓) / medium(8~30일) / long(31일↑)
  const [filterDuration, setFilterDuration] = useState('all')
  // 지역 필터: all / daehakro / seoul_center / seoul_outer / province
  const [filterRegion,   setFilterRegion]   = useState('all')
  // 장르 필터: all / 뮤지컬 / 연극 / 오페라 / 기타
  const [filterGenre,    setFilterGenre]    = useState('all')
  // 정렬: collectedAt_desc(등록일) / startDate_asc(시작일) / duration_asc(기간 짧은 순)
  const [sortBy,         setSortBy]         = useState('collectedAt_desc')
  // 대기 중 현재 페이지 (0-indexed)
  const [pendingPage,    setPendingPage]     = useState(0)
  // 사이드 패널에서 수정 중인 공연 (null이면 패널 닫힘)
  const [editingShow,    setEditingShow]     = useState(null)

  // 공연 추가 폼 상태
  const [addForm,        setAddForm]        = useState({ ...EMPTY_FORM })
  const [addStatus,      setAddStatus]      = useState(null)   // { type, msg }
  const [addLoading,     setAddLoading]     = useState(false)
  const [addTicketLinks, setAddTicketLinks] = useState([])
  // 공연 추가 폼 - 출연진 목록: [{ actorId, actorName, actorImage, role }]
  const [addCast,        setAddCast]        = useState([])

  // 배우 관리 탭 상태
  const [actorsList,    setActorsList]    = useState([])
  const [actorsLoading, setActorsLoading] = useState(false)
  // actorEdits: { [docId]: { imageUrl: string } }
  const [actorEdits,    setActorEdits]    = useState({})
  // 배우 관리 서브탭: 'review' (사진 검토) | 'list' (배우 전체 목록)
  const [actorSubTab,          setActorSubTab]          = useState('review')
  // pending_actors 컬렉션 (플레이DB 수집 검토 대기 사진)
  const [pendingActors,        setPendingActors]        = useState([])
  const [pendingActorsLoading, setPendingActorsLoading] = useState(false)
  // 배우 이름 검색 + 정렬
  const [actorSearch, setActorSearch] = useState('')
  const [actorSort,   setActorSort]   = useState('name') // 'name' | 'shows'
  const [actorPage,      setActorPage]      = useState(1)
  const ACTORS_PER_PAGE = 20
  const [actorEditOpen,  setActorEditOpen]  = useState(null) // 열린 카드의 actor.id
  const [actorListToast, setActorListToast] = useState('')
  function showActorListToast(msg) {
    setActorListToast(msg)
    setTimeout(() => setActorListToast(''), 2500)
  }

  // ── Firestore 실시간 구독 ────────────────────
  useEffect(() => {
    if (!authed || !isFirebaseConfigured || !db) return

    setDataLoading(true)

    const unsubPending = onSnapshot(
      query(collection(db, 'pending'), orderBy('collectedAt', 'desc')),
      snap => {
        setPendingList(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setDataLoading(false)
      },
      err => { console.error('pending 로드 오류:', err); setDataLoading(false) }
    )

    const unsubShows = onSnapshot(
      query(collection(db, 'shows'), orderBy('startDate', 'desc')),
      snap => setShowsList(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.error('shows 로드 오류:', err)
    )

    return () => { unsubPending(); unsubShows() }
  }, [authed])

  // 배우 관리 탭 진입 시 actors 컬렉션 로드
  useEffect(() => {
    if (tab !== 'actors' || !authed || !isFirebaseConfigured || !db) return
    setActorsLoading(true)
    getDocs(query(collection(db, 'actors'), orderBy('name')))
      .then(snap => {
        setActorsList(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setActorsLoading(false)
      })
      .catch(err => { console.error('배우 로드 오류:', err); setActorsLoading(false) })
  }, [tab, authed])

  // 태그 제안 탭 진입 시 tagSuggestions 로드
  useEffect(() => {
    if (tab !== 'suggestions' || !authed || !isFirebaseConfigured || !db) return
    getDocs(query(collection(db, 'tagSuggestions'), where('status', '==', 'pending'), orderBy('createdAt', 'desc')))
      .then(snap => setSuggestionsList(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(err => console.error('태그 제안 로드 오류:', err))
  }, [tab, authed])

  async function handleApproveSuggestion(s) {
    if (!isFirebaseConfigured || !db) return
    try {
      await updateDoc(doc(db, 'shows', s.showId), { showTags: arrayUnion(s.tag) })
      await updateDoc(doc(db, 'tagSuggestions', s.id), { status: 'approved' })
      setSuggestionsList(prev => prev.filter(x => x.id !== s.id))
    } catch (err) { console.error('승인 오류:', err) }
  }

  async function handleRejectSuggestion(id) {
    if (!isFirebaseConfigured || !db) return
    try {
      await updateDoc(doc(db, 'tagSuggestions', id), { status: 'rejected' })
      setSuggestionsList(prev => prev.filter(x => x.id !== id))
    } catch (err) { console.error('거절 오류:', err) }
  }

  // 사진 검토 서브탭 진입 시 pending_actors 컬렉션 로드
  useEffect(() => {
    if (tab !== 'actors' || actorSubTab !== 'review' || !authed || !isFirebaseConfigured || !db) return
    setPendingActorsLoading(true)
    getDocs(collection(db, 'pending_actors'))
      .then(snap => {
        setPendingActors(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setPendingActorsLoading(false)
      })
      .catch(err => { console.error('pending_actors 로드 오류:', err); setPendingActorsLoading(false) })
  }, [tab, actorSubTab, authed])

  // ── 배우별 출연 공연 수 + 공연 제목 집계 (shows + pending 전체 cast 스캔) ──
  const actorShowCountMap = useMemo(() => {
    const map = {}
    for (const show of [...showsList, ...pendingList]) {
      if (!Array.isArray(show.cast)) continue
      const seen = new Set()
      for (const m of show.cast) {
        const name = m.actorName?.trim()
        if (name && !seen.has(name)) { seen.add(name); map[name] = (map[name] ?? 0) + 1 }
      }
    }
    return map
  }, [showsList, pendingList])

  // 배우 이름 → 출연 중인 공연 제목 배열
  const actorShowsMap = useMemo(() => {
    const map = {}
    for (const show of [...showsList, ...pendingList]) {
      if (!Array.isArray(show.cast)) continue
      const title = show.title?.trim()
      if (!title) continue
      for (const m of show.cast) {
        const name = m.actorName?.trim()
        if (!name) continue
        if (!map[name]) map[name] = []
        if (!map[name].includes(title)) map[name].push(title)
      }
    }
    return map
  }, [showsList, pendingList])

  // ── 필터 + 정렬 적용된 대기 목록 ────────────
  const filteredPendingList = pendingList
    .filter(show => {
      // 기간 필터 적용
      if (filterDuration !== 'all') {
        const cat = getDurationCategory(getDurationDays(show))
        if (cat !== filterDuration) return false
      }
      // 지역 필터 적용
      if (filterRegion !== 'all') {
        if (getRegionCategory(show) !== filterRegion) return false
      }
      // 장르 필터 적용
      if (filterGenre !== 'all') {
        const genre = show.genre ?? ''
        const isOther = !['뮤지컬', '연극', '오페라'].includes(genre)
        if (filterGenre === '기타' ? !isOther : genre !== filterGenre) return false
      }
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'startDate_asc') {
        return (a.startDate ?? '').localeCompare(b.startDate ?? '')
      }
      if (sortBy === 'duration_asc') {
        const da = getDurationDays(a) ?? 9999
        const db = getDurationDays(b) ?? 9999
        return da - db
      }
      // 기본: 등록일 내림차순 (collectedAt_desc)
      const ta = a.collectedAt?.seconds ?? 0
      const tb = b.collectedAt?.seconds ?? 0
      return tb - ta
    })

  // ── 페이지네이션: 필터 변경 시 첫 페이지로 리셋 ──
  useEffect(() => { setPendingPage(0) }, [filterDuration, filterRegion, filterGenre, sortBy])

  // 현재 페이지에 보여줄 행 (50건 슬라이싱)
  const totalPendingPages   = Math.max(1, Math.ceil(filteredPendingList.length / PENDING_PAGE_SIZE))
  const paginatedPendingList = filteredPendingList.slice(
    pendingPage * PENDING_PAGE_SIZE,
    (pendingPage + 1) * PENDING_PAGE_SIZE,
  )

  // ── 등록 완료 탭 필터 + 정렬 + 페이지네이션 ────
  const filteredShowsList = showsList
    .filter(show => {
      if (showsSearch.trim()) {
        if (!show.title?.includes(showsSearch.trim())) return false
      }
      if (showsFilterGenre !== 'all') {
        const genre = show.genre ?? ''
        const isOther = !['뮤지컬', '연극', '오페라'].includes(genre)
        if (showsFilterGenre === '기타' ? !isOther : genre !== showsFilterGenre) return false
      }
      return true
    })
    .sort((a, b) => {
      if (showsSortBy === 'startDate_asc') {
        return (a.startDate ?? '').localeCompare(b.startDate ?? '')
      }
      if (showsSortBy === 'duration_asc') {
        const da = getDurationDays(a) ?? 9999
        const db = getDurationDays(b) ?? 9999
        return da - db
      }
      // 기본: 등록일 내림차순
      const ta = a.approvedAt?.seconds ?? a.collectedAt?.seconds ?? 0
      const tb = b.approvedAt?.seconds ?? b.collectedAt?.seconds ?? 0
      return tb - ta
    })

  useEffect(() => { setShowsPage(0) }, [showsSearch, showsFilterGenre, showsSortBy])

  const totalShowsPages    = Math.max(1, Math.ceil(filteredShowsList.length / SHOWS_PAGE_SIZE))
  const paginatedShowsList = filteredShowsList.slice(
    showsPage * SHOWS_PAGE_SIZE,
    (showsPage + 1) * SHOWS_PAGE_SIZE,
  )

  // ── 체크박스 ─────────────────────────────────
  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // 현재 필터된 항목만 전체 선택/해제
  function toggleSelectAll() {
    const filteredIds     = filteredPendingList.map(s => s.id)
    const allSelected     = filteredIds.length > 0 && filteredIds.every(id => selected.has(id))
    if (allSelected) {
      // 필터 항목 선택 해제
      setSelected(prev => {
        const next = new Set(prev)
        filteredIds.forEach(id => next.delete(id))
        return next
      })
    } else {
      // 필터 항목 전체 추가 선택 (기존 선택 유지)
      setSelected(prev => new Set([...prev, ...filteredIds]))
    }
  }

  // ── 단건 승인: pending → shows ───────────────
  async function handleApprove(id) {
    const show = pendingList.find(s => s.id === id)
    if (!show) return
    try {
      const { status, source, collectedAt, ...showData } = show
      const batch = writeBatch(db)
      batch.set(doc(db, 'shows', id), { ...showData, id, approvedAt: serverTimestamp() })
      batch.delete(doc(db, 'pending', id))
      await batch.commit()
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
    } catch (err) {
      console.error('승인 오류:', err)
      alert('승인 중 오류가 발생했습니다.')
    }
  }

  // ── 단건 거절 ────────────────────────────────
  async function handleReject(id) {
    if (!window.confirm('이 공연 신청을 거절(삭제)하시겠습니까?')) return

    // Firebase 연결 여부 사전 확인
    if (!isFirebaseConfigured || !db) {
      alert('Firebase가 연결되지 않았습니다.')
      return
    }

    try {
      await deleteDoc(doc(db, 'pending', id))
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
    } catch (err) {
      // 오류 코드·메시지를 콘솔에 명확히 출력
      console.error('[handleReject] pending 문서 삭제 실패')
      console.error('  문서 ID :', id)
      console.error('  오류 코드:', err?.code ?? '알 수 없음')
      console.error('  오류 메시지:', err?.message ?? String(err))

      // Firestore 권한 오류 vs 그 외 오류 구분
      if (err?.code === 'permission-denied') {
        alert('권한이 없습니다. Firestore 보안 규칙을 확인해주세요.')
      } else {
        alert(`거절 중 오류가 발생했습니다.\n(${err?.code ?? err?.message ?? '알 수 없는 오류'})`)
      }
    }
  }

  // ── pending 수정 저장 ─────────────────────────
  async function handleUpdatePending(id, data) {
    try {
      const { id: _, ...rest } = data
      await setDoc(doc(db, 'pending', id), { ...rest, id }, { merge: true })
    } catch (err) {
      console.error('수정 오류:', err)
      alert('수정 중 오류가 발생했습니다.')
    }
  }

  // ── 일괄 승인 ─────────────────────────────────
  async function handleBulkApprove() {
    if (selected.size === 0) return
    if (!window.confirm(`선택한 ${selected.size}개 공연을 승인하시겠습니까?`)) return
    try {
      const batch = writeBatch(db)
      for (const id of selected) {
        const show = pendingList.find(s => s.id === id)
        if (!show) continue
        const { status, source, collectedAt, ...showData } = show
        batch.set(doc(db, 'shows', id), { ...showData, id, approvedAt: serverTimestamp() })
        batch.delete(doc(db, 'pending', id))
      }
      await batch.commit()
      setSelected(new Set())
    } catch (err) {
      console.error('일괄 승인 오류:', err)
      alert('일괄 승인 중 오류가 발생했습니다.')
    }
  }

  // ── 일괄 거절 ─────────────────────────────────
  async function handleBulkReject() {
    if (selected.size === 0) return
    if (!window.confirm(`선택한 ${selected.size}개 공연을 거절(삭제)하시겠습니까?`)) return

    if (!isFirebaseConfigured || !db) {
      alert('Firebase가 연결되지 않았습니다.')
      return
    }

    try {
      const batch = writeBatch(db)
      for (const id of selected) batch.delete(doc(db, 'pending', id))
      await batch.commit()
      setSelected(new Set())
    } catch (err) {
      console.error('[handleBulkReject] 일괄 삭제 실패')
      console.error('  오류 코드:', err?.code ?? '알 수 없음')
      console.error('  오류 메시지:', err?.message ?? String(err))

      if (err?.code === 'permission-denied') {
        alert('권한이 없습니다. Firestore 보안 규칙을 확인해주세요.')
      } else {
        alert(`일괄 거절 중 오류가 발생했습니다.\n(${err?.code ?? err?.message ?? '알 수 없는 오류'})`)
      }
    }
  }

  // ── 공연 추가 폼 제출 → pending ──────────────
  async function handleAddShow(e) {
    e.preventDefault()
    setAddStatus(null)

    if (!addForm.title.trim()) {
      setAddStatus({ type: 'error', msg: '제목을 입력해주세요.' })
      return
    }
    if (!isFirebaseConfigured || !db) {
      setAddStatus({ type: 'error', msg: 'Firebase가 연결되지 않았습니다.' })
      return
    }

    setAddLoading(true)
    try {
      const id   = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const tags = addForm.tags.split(',').map(t => t.trim()).filter(Boolean)
      const ticketLinks = addTicketLinks.filter(l => l.url?.trim())
      const ticketUrl   = ticketLinks.find(l => l.url)?.url ?? addForm.ticketUrl ?? ''
      await setDoc(doc(db, 'pending', id), {
        ...addForm,
        tags,
        id,
        runtime:      addForm.runtime ? Number(addForm.runtime) : null,
        ticketLinks,
        ticketUrl,
        // 출연진 저장 (이미지 URL 포함)
        cast:         addCast,
        status:       'pending',
        collectedAt:  serverTimestamp(),
      })
      setAddStatus({ type: 'success', msg: `「${addForm.title}」이(가) 대기열에 추가됐습니다. 대기 중 탭에서 승인해주세요.` })
      setAddForm({ ...EMPTY_FORM })
      setAddTicketLinks([])
      setAddCast([])
    } catch (err) {
      console.error('공연 추가 오류:', err)
      setAddStatus({ type: 'error', msg: '저장 중 오류가 발생했습니다.' })
    } finally {
      setAddLoading(false)
    }
  }

  // ── shows 수정 ────────────────────────────────
  async function handleUpdateShow(id, data) {
    try {
      const { id: _, ...rest } = data
      await setDoc(doc(db, 'shows', id), { ...rest, id }, { merge: true })
    } catch (err) {
      console.error('shows 수정 오류:', err)
      alert('수정 중 오류가 발생했습니다.')
    }
  }

  // ── shows 반려: 문서는 보존하고 status만 변경 ──
  async function handleRevertShow(id) {
    if (!window.confirm('이 공연을 반려 처리할까요?\n연결된 댓글·투표 데이터는 유지됩니다.')) return
    const show = showsList.find(s => s.id === id)
    if (!show) return
    try {
      await updateDoc(doc(db, 'shows', id), { status: 'rejected' })
    } catch (err) {
      console.error('반려 오류:', err)
      alert('반려 중 오류가 발생했습니다.')
    }
  }

  // ── shows 삭제 ────────────────────────────────
  async function handleDeleteShow(id) {
    if (!window.confirm('정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return
    if (!isFirebaseConfigured || !db) { alert('Firebase가 연결되지 않았습니다.'); return }
    try {
      await deleteDoc(doc(db, 'shows', id))
    } catch (err) {
      console.error('[handleDeleteShow] shows 문서 삭제 실패')
      console.error('  문서 ID :', id)
      console.error('  오류 코드:', err?.code ?? '알 수 없음')
      console.error('  오류 메시지:', err?.message ?? String(err))
      if (err?.code === 'permission-denied') {
        alert('권한이 없습니다. Firestore 보안 규칙에 delete 권한을 추가해주세요.')
      } else {
        alert(`삭제 중 오류가 발생했습니다.\n(${err?.code ?? err?.message ?? '알 수 없는 오류'})`)
      }
    }
  }


  // ── pending_actors 승인: actors imageUrl 업데이트 + pending_actors 문서 삭제 ──
  async function handleApprovePendingActor(pending, imageUrl) {
    try {
      const actorUpdate = { imageUrl: imageUrl.trim() }
      if (pending.profileUrl) actorUpdate.profileUrl = pending.profileUrl
      await updateDoc(doc(db, 'actors', pending.actorId), actorUpdate)
      await deleteDoc(doc(db, 'pending_actors', pending.id))
      setPendingActors(prev => prev.filter(p => p.id !== pending.id))
      // 배우 전체 목록 탭에도 즉시 반영
      setActorsList(prev =>
        prev.map(a => a.id === pending.actorId
          ? { ...a, imageUrl: imageUrl.trim(), ...(pending.profileUrl ? { profileUrl: pending.profileUrl } : {}) }
          : a)
      )
    } catch (err) {
      console.error('배우 사진 승인 오류:', err)
      alert('저장 중 오류가 발생했습니다.')
    }
  }

  // ── pending_actors 거절: 해당 문서 삭제만 ──────────────────
  async function handleRejectPendingActor(pendingId) {
    try {
      await deleteDoc(doc(db, 'pending_actors', pendingId))
      setPendingActors(prev => prev.filter(p => p.id !== pendingId))
    } catch (err) {
      console.error('배우 사진 거절 오류:', err)
      alert('삭제 중 오류가 발생했습니다.')
    }
  }

  // ── 비밀번호 로그인 화면 ──────────────────────
  if (!authed) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          {/* 자물쇠 아이콘 */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16
                            bg-stone-100 rounded-2xl text-3xl mb-4">
              🔐
            </div>
            <h1 className="font-display text-2xl font-bold text-stone-900">관리자 로그인</h1>
            <p className="text-sm text-stone-400 mt-1">관리자 전용 페이지입니다</p>
          </div>

          <form
            onSubmit={e => {
              e.preventDefault()
              password === ADMIN_PW ? setAuthed(true) : alert('비밀번호가 틀렸습니다.')
            }}
            className="space-y-3"
          >
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="비밀번호 입력"
              autoFocus
              className={INPUT}
            />
            <button
              type="submit"
              className="w-full bg-stone-900 text-white py-3 rounded-xl text-sm
                         font-semibold hover:bg-amber-700 transition-colors"
            >
              입장하기
            </button>
          </form>
          <p className="text-center text-xs text-stone-300 mt-4">
            기본 비밀번호: theater2025
          </p>
        </div>
      </div>
    )
  }


  // ── 관리자 메인 화면 ──────────────────────────
  return (
    <div className="bg-stone-50 min-h-screen -mt-4 -mx-4 px-4 pt-6 pb-16">
      {/* 수정 사이드 패널 — 공연 행의 "수정" 버튼 클릭 시 열림 */}
      {editingShow && (
        <PendingEditPanel
          show={editingShow}
          onSave={handleUpdatePending}
          onClose={() => setEditingShow(null)}
        />
      )}

      <div className="max-w-6xl mx-auto space-y-6">

        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-stone-900">관리자 패널</h1>
            <p className="text-xs text-stone-400 mt-0.5">
              Firebase {isFirebaseConfigured
                ? <span className="text-emerald-600 font-medium">연결됨</span>
                : <span className="text-amber-600 font-medium">미연결</span>}
            </p>
          </div>
        </div>

        {/* 탭 */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-1.5 flex gap-1">
          {[
            { key: 'pending',     icon: '⏳', label: '대기 중',  count: pendingList.length },
            { key: 'add',         icon: '➕', label: '공연 추가', count: null },
            { key: 'shows',       icon: '✅', label: '등록 완료', count: showsList.length },
            { key: 'actors',      icon: '👤', label: '배우 관리', count: null },
            { key: 'suggestions', icon: '🏷️', label: '태그 제안', count: suggestionsList.length || null },
            { key: 'casting',     icon: '🎬', label: '캐스팅',   count: null },
          ].map(({ key, icon, label, count }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl
                          text-sm font-semibold transition-all ${
                tab === key
                  ? 'bg-stone-900 text-white shadow-sm'
                  : 'text-stone-500 hover:bg-stone-50'
              }`}
            >
              <span>{icon}</span>
              <span className="hidden sm:inline">{label}</span>
              {count !== null && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  tab === key ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-500'
                }`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>


        {/* ════════ 대기 중 탭 ════════ */}
        {tab === 'pending' && (
          <div className="space-y-4">

            {/* ── 스마트 필터 바 ── */}
            {pendingList.length > 0 && (
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 space-y-3">

                {/* 공연 기간 필터 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-stone-500 w-10 shrink-0">기간</span>
                  {[
                    { value: 'all',    label: '전체' },
                    { value: 'short',  label: '단기 7일↓',    on: 'bg-red-500 text-white' },
                    { value: 'medium', label: '단중기 8~30일', on: 'bg-amber-500 text-white' },
                    { value: 'long',   label: '장기 31일↑',   on: 'bg-emerald-600 text-white' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setFilterDuration(opt.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        filterDuration === opt.value
                          ? (opt.on ?? 'bg-stone-900 text-white')
                          : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* 지역 필터 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-stone-500 w-10 shrink-0">지역</span>
                  {[
                    { value: 'all',          label: '전체' },
                    { value: 'daehakro',     label: '대학로' },
                    { value: 'seoul_center', label: '서울 중심' },
                    { value: 'seoul_outer',  label: '서울 외곽' },
                    { value: 'province',     label: '지방' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setFilterRegion(opt.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        filterRegion === opt.value
                          ? 'bg-stone-900 text-white'
                          : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* 장르 필터 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-stone-500 w-10 shrink-0">장르</span>
                  {[
                    { value: 'all',   label: '전체' },
                    { value: '뮤지컬', label: '뮤지컬' },
                    { value: '연극',   label: '연극' },
                    { value: '오페라', label: '오페라' },
                    { value: '기타',   label: '기타' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setFilterGenre(opt.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        filterGenre === opt.value
                          ? 'bg-stone-900 text-white'
                          : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* 정렬 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-stone-500 w-10 shrink-0">정렬</span>
                  {[
                    { value: 'collectedAt_desc', label: '등록일 순' },
                    { value: 'startDate_asc',    label: '시작일 순' },
                    { value: 'duration_asc',     label: '기간 짧은 순' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setSortBy(opt.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        sortBy === opt.value
                          ? 'bg-stone-900 text-white'
                          : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* 필터 적용 결과 건수 */}
                {(filterDuration !== 'all' || filterRegion !== 'all' || filterGenre !== 'all') && (
                  <p className="text-xs text-stone-400 pt-0.5">
                    필터 결과: <span className="font-semibold text-stone-600">{filteredPendingList.length}개</span>
                    {' '}/ 전체 {pendingList.length}개
                  </p>
                )}
              </div>
            )}

            {/* ── 일괄 액션 바 ── */}
            {filteredPendingList.length > 0 && (
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-4 py-3
                              flex flex-wrap items-center gap-3">
                {/* 필터 항목 전체 선택 체크박스 */}
                <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={
                      filteredPendingList.length > 0 &&
                      filteredPendingList.every(s => selected.has(s.id))
                    }
                    onChange={toggleSelectAll}
                    className="w-4 h-4 accent-amber-500"
                  />
                  <span className="font-medium">
                    {filterDuration !== 'all' || filterRegion !== 'all'
                      ? '필터된 항목 전체 선택'
                      : '전체 선택'}
                  </span>
                </label>

                {selected.size > 0 && (
                  <>
                    <span className="text-xs text-stone-400 bg-stone-100 px-2 py-1 rounded-full">
                      {selected.size}개 선택됨
                    </span>
                    <div className="ml-auto flex gap-2">
                      <button
                        onClick={handleBulkApprove}
                        className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold
                                   rounded-lg hover:bg-emerald-500 transition-colors"
                      >
                        ✅ 일괄 승인
                      </button>
                      <button
                        onClick={handleBulkReject}
                        className="px-4 py-2 bg-red-500 text-white text-sm font-semibold
                                   rounded-lg hover:bg-red-400 transition-colors"
                      >
                        ❌ 일괄 거절
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── 리스트 테이블 ── */}
            {dataLoading ? (
              <div className="text-center py-16 text-stone-400">
                <div className="text-4xl mb-3 animate-pulse">⏳</div>
                <p>불러오는 중...</p>
              </div>
            ) : pendingList.length === 0 ? (
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm
                              text-center py-16 text-stone-400">
                <div className="text-5xl mb-3">📭</div>
                <p className="font-medium text-stone-600 mb-1">대기 중인 공연이 없습니다</p>
                <button
                  onClick={() => setTab('add')}
                  className="text-sm text-amber-600 underline hover:text-amber-500"
                >
                  공연 추가 탭에서 추가해보세요
                </button>
              </div>
            ) : filteredPendingList.length === 0 ? (
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm
                              text-center py-12 text-stone-400">
                <div className="text-4xl mb-3">🔍</div>
                <p className="font-medium text-stone-600 mb-2">필터에 해당하는 공연이 없습니다</p>
                <button
                  onClick={() => { setFilterDuration('all'); setFilterRegion('all'); setFilterGenre('all') }}
                  className="text-sm text-amber-600 underline hover:text-amber-500"
                >
                  필터 초기화
                </button>
              </div>
            ) : (
              <>
                {/* 리스트 컨테이너 */}
                <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
                  {/* 컬럼 헤더 */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-stone-50 border-b border-stone-100
                                  text-xs font-semibold text-stone-400">
                    <span className="w-4 shrink-0" />
                    <span className="w-[50px] shrink-0">포스터</span>
                    <span className="flex-1">공연명</span>
                    <span className="hidden md:block w-36 shrink-0">공연장</span>
                    <span className="hidden lg:block w-28 shrink-0 text-center">기간</span>
                    <span className="hidden sm:block w-12 shrink-0 text-center">캐스트</span>
                    <span className="w-[132px] shrink-0 text-center">액션</span>
                  </div>

                  {/* 공연 행 목록 */}
                  {paginatedPendingList.map(show => (
                    <PendingRow
                      key={show.id}
                      show={show}
                      selected={selected.has(show.id)}
                      onSelect={() => toggleSelect(show.id)}
                      onEdit={setEditingShow}
                      onApprove={handleApprove}
                      onReject={handleReject}
                      riskLevel={getRiskLevel(show)}
                    />
                  ))}
                </div>

                {/* 페이지네이션 */}
                {totalPendingPages > 1 && (
                  <div className="flex items-center justify-between bg-white rounded-2xl
                                  border border-stone-100 shadow-sm px-4 py-3">
                    <span className="text-xs text-stone-400">
                      {pendingPage * PENDING_PAGE_SIZE + 1}–
                      {Math.min((pendingPage + 1) * PENDING_PAGE_SIZE, filteredPendingList.length)}
                      {' '}/ {filteredPendingList.length}건
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setPendingPage(0)}
                        disabled={pendingPage === 0}
                        className="px-2 py-1 text-xs rounded-lg bg-stone-100 text-stone-500
                                   hover:bg-stone-200 disabled:opacity-30 transition-colors"
                      >
                        «
                      </button>
                      <button
                        onClick={() => setPendingPage(p => Math.max(0, p - 1))}
                        disabled={pendingPage === 0}
                        className="px-2.5 py-1 text-xs rounded-lg bg-stone-100 text-stone-500
                                   hover:bg-stone-200 disabled:opacity-30 transition-colors"
                      >
                        ‹
                      </button>
                      {/* 페이지 번호 버튼 (최대 5개) */}
                      {Array.from({ length: totalPendingPages }, (_, i) => i)
                        .filter(i => Math.abs(i - pendingPage) <= 2)
                        .map(i => (
                          <button
                            key={i}
                            onClick={() => setPendingPage(i)}
                            className={`w-7 h-7 text-xs rounded-lg transition-colors ${
                              i === pendingPage
                                ? 'bg-stone-900 text-white'
                                : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                            }`}
                          >
                            {i + 1}
                          </button>
                        ))
                      }
                      <button
                        onClick={() => setPendingPage(p => Math.min(totalPendingPages - 1, p + 1))}
                        disabled={pendingPage === totalPendingPages - 1}
                        className="px-2.5 py-1 text-xs rounded-lg bg-stone-100 text-stone-500
                                   hover:bg-stone-200 disabled:opacity-30 transition-colors"
                      >
                        ›
                      </button>
                      <button
                        onClick={() => setPendingPage(totalPendingPages - 1)}
                        disabled={pendingPage === totalPendingPages - 1}
                        className="px-2 py-1 text-xs rounded-lg bg-stone-100 text-stone-500
                                   hover:bg-stone-200 disabled:opacity-30 transition-colors"
                      >
                        »
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}


        {/* ════════ 공연 추가 탭 ════════ */}
        {tab === 'add' && (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-6">
            <div className="mb-6">
              <h2 className="font-display text-xl font-bold text-stone-900">공연 추가</h2>
              <p className="text-sm text-stone-400 mt-1">
                입력한 정보는 <span className="font-medium text-amber-600">대기 중</span> 목록에 저장됩니다.
                승인 후 사이트에 공개됩니다.
              </p>
            </div>

            <form onSubmit={handleAddShow} className="space-y-4">
              {/* 기본 정보 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className={LABEL}>제목 *</label>
                  <input
                    value={addForm.title}
                    onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="공연 제목을 입력하세요"
                    required
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL}>부제목</label>
                  <input
                    value={addForm.subtitle}
                    onChange={e => setAddForm(f => ({ ...f, subtitle: e.target.value }))}
                    placeholder="영문 제목 또는 부제"
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL}>장르 *</label>
                  <select
                    value={addForm.genre}
                    onChange={e => setAddForm(f => ({ ...f, genre: e.target.value }))}
                    required
                    className={INPUT}
                  >
                    <option value="">장르 선택</option>
                    {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>공연장 *</label>
                  <input
                    value={addForm.venue}
                    onChange={e => setAddForm(f => ({ ...f, venue: e.target.value }))}
                    placeholder="예: 충무아트센터 대극장"
                    required
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL}>주소</label>
                  <input
                    value={addForm.address}
                    onChange={e => setAddForm(f => ({ ...f, address: e.target.value }))}
                    placeholder="예: 서울 중구 퇴계로 387"
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL}>시작일 *</label>
                  <input
                    type="date"
                    value={addForm.startDate}
                    onChange={e => setAddForm(f => ({ ...f, startDate: e.target.value }))}
                    required
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL}>종료일 *</label>
                  <input
                    type="date"
                    value={addForm.endDate}
                    onChange={e => setAddForm(f => ({ ...f, endDate: e.target.value }))}
                    required
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL}>상연시간 (분)</label>
                  <input
                    type="number"
                    value={addForm.runtime}
                    onChange={e => setAddForm(f => ({ ...f, runtime: e.target.value }))}
                    placeholder="예: 180"
                    min="1"
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL}>티켓 URL (단일)</label>
                  <input
                    value={addForm.ticketUrl}
                    onChange={e => setAddForm(f => ({ ...f, ticketUrl: e.target.value }))}
                    placeholder="https://... (예매처가 여러 개면 아래에서 추가)"
                    className={INPUT}
                  />
                </div>
              </div>

              {/* 티켓 링크 복수 입력 */}
              <TicketLinksSection links={addTicketLinks} onChange={setAddTicketLinks} />

              {/* 시놉시스 */}
              <div>
                <label className={LABEL}>시놉시스</label>
                <textarea
                  value={addForm.synopsis}
                  onChange={e => setAddForm(f => ({ ...f, synopsis: e.target.value }))}
                  rows={4}
                  placeholder="공연 줄거리 및 소개를 입력하세요"
                  className={`${INPUT} resize-none`}
                />
              </div>

              {/* 태그 */}
              <div>
                <label className={LABEL}>태그 (쉼표로 구분)</label>
                <input
                  value={addForm.tags}
                  onChange={e => setAddForm(f => ({ ...f, tags: e.target.value }))}
                  placeholder="대형뮤지컬, 명작, 가족"
                  className={INPUT}
                />
              </div>

              {/* 출처 */}
              <div>
                <label className={LABEL}>출처</label>
                <input
                  value={addForm.source}
                  onChange={e => setAddForm(f => ({ ...f, source: e.target.value }))}
                  placeholder="예: 뮤지컬DB, 수동입력"
                  className={INPUT}
                />
              </div>

              {/* 출연진 검색 & 추가 */}
              <div className="border-t border-stone-100 pt-4">
                <ActorCastSection cast={addCast} onChange={setAddCast} />
              </div>

              {/* 제출 버튼 */}
              <div className="pt-2 flex gap-3">
                <button
                  type="submit"
                  disabled={addLoading}
                  className="flex-1 sm:flex-none px-8 py-3 bg-stone-900 text-white text-sm
                             font-semibold rounded-xl hover:bg-amber-700 transition-colors
                             disabled:opacity-40"
                >
                  {addLoading ? '저장 중...' : '대기열에 추가하기'}
                </button>
                <button
                  type="button"
                  onClick={() => { setAddForm({ ...EMPTY_FORM }); setAddCast([]) }}
                  className="px-6 py-3 border border-stone-200 text-stone-500 text-sm
                             rounded-xl hover:bg-stone-50 transition-colors"
                >
                  초기화
                </button>
              </div>

              {/* 결과 메시지 */}
              {addStatus && (
                <div className={`p-4 rounded-xl text-sm font-medium ${
                  addStatus.type === 'success'
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border border-red-200 text-red-800'
                }`}>
                  {addStatus.type === 'success' ? '✅ ' : '❌ '}{addStatus.msg}
                </div>
              )}
            </form>
          </div>
        )}


        {/* ════════ 등록 완료 탭 ════════ */}
        {tab === 'shows' && (
          <div className="space-y-4">
            {showsList.length === 0 ? (
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm
                              text-center py-16 text-stone-400">
                <div className="text-5xl mb-3">🎭</div>
                <p className="font-medium text-stone-600 mb-1">등록된 공연이 없습니다</p>
                <p className="text-sm">대기 중 탭에서 공연을 승인하면 여기에 표시됩니다</p>
              </div>
            ) : (
              <>
                {/* ── 검색 + 필터 바 ── */}
                <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 space-y-3">
                  {/* 검색 */}
                  <input
                    type="text"
                    value={showsSearch}
                    onChange={e => setShowsSearch(e.target.value)}
                    placeholder="공연명 검색…"
                    className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg
                               focus:outline-none focus:border-stone-400"
                  />

                  {/* 장르 필터 */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-stone-500 w-10 shrink-0">장르</span>
                    {[
                      { value: 'all',   label: '전체' },
                      { value: '뮤지컬', label: '뮤지컬' },
                      { value: '연극',   label: '연극' },
                      { value: '오페라', label: '오페라' },
                      { value: '기타',   label: '기타' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setShowsFilterGenre(opt.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          showsFilterGenre === opt.value
                            ? 'bg-stone-900 text-white'
                            : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* 정렬 */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-stone-500 w-10 shrink-0">정렬</span>
                    {[
                      { value: 'collectedAt_desc', label: '등록일 순' },
                      { value: 'startDate_asc',    label: '시작일 순' },
                      { value: 'duration_asc',     label: '기간 짧은 순' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setShowsSortBy(opt.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          showsSortBy === opt.value
                            ? 'bg-stone-900 text-white'
                            : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* 결과 건수 */}
                  <p className="text-xs text-stone-400 pt-0.5">
                    전체 <span className="font-semibold text-stone-600">{showsList.length}개</span>
                    {filteredShowsList.length !== showsList.length && (
                      <> · 필터 결과 <span className="font-semibold text-stone-600">{filteredShowsList.length}개</span></>
                    )}
                  </p>
                </div>

                {/* ── 카드 목록 ── */}
                {filteredShowsList.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-stone-100 shadow-sm
                                  text-center py-12 text-stone-400">
                    <div className="text-4xl mb-3">🔍</div>
                    <p className="font-medium text-stone-600 mb-2">검색 결과가 없습니다</p>
                    <button
                      onClick={() => { setShowsSearch(''); setShowsFilterGenre('all') }}
                      className="text-sm text-amber-600 underline hover:text-amber-500"
                    >
                      필터 초기화
                    </button>
                  </div>
                ) : (
                  <>
                    <ul className="space-y-1.5">
                      {paginatedShowsList.map(show => (
                        <ShowCard
                          key={show.id}
                          show={show}
                          onUpdate={handleUpdateShow}
                          onDelete={handleDeleteShow}
                          onRevert={handleRevertShow}
                        />
                      ))}
                    </ul>

                    {/* ── 페이지네이션 ── */}
                    {totalShowsPages > 1 && (
                      <div className="flex items-center justify-center gap-3 py-2">
                        <button
                          onClick={() => setShowsPage(p => Math.max(0, p - 1))}
                          disabled={showsPage === 0}
                          className="px-4 py-2 rounded-lg text-sm font-semibold border border-stone-200
                                     text-stone-600 hover:bg-stone-50 disabled:opacity-40 transition-colors"
                        >
                          이전
                        </button>
                        <span className="text-sm text-stone-500">
                          {showsPage + 1} / {totalShowsPages}
                        </span>
                        <button
                          onClick={() => setShowsPage(p => Math.min(totalShowsPages - 1, p + 1))}
                          disabled={showsPage === totalShowsPages - 1}
                          className="px-4 py-2 rounded-lg text-sm font-semibold border border-stone-200
                                     text-stone-600 hover:bg-stone-50 disabled:opacity-40 transition-colors"
                        >
                          다음
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}


        {/* ════════ 태그 제안 탭 ════════ */}
        {tab === 'suggestions' && (
          <div className="space-y-3">
            <h2 className="font-display text-lg font-bold text-stone-800">태그 제안 관리</h2>

            {suggestionsList.length === 0 ? (
              <div className="bg-white rounded-2xl border border-stone-100 text-center py-12 text-stone-400">
                <p className="text-3xl mb-2">🏷️</p>
                <p className="text-sm">검토 대기 중인 태그 제안이 없습니다</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {suggestionsList.map(s => (
                  <li key={s.id}
                    className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl
                               border border-stone-100 hover:border-stone-200 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">{s.showTitle}</p>
                      <p className="text-xs text-stone-400 mt-0.5">
                        제안자: {s.nickname || '익명'} · 태그:{' '}
                        <span className="font-semibold text-[#2C1810]">{s.tag}</span>
                      </p>
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-[#2C1810]/10 text-[#2C1810] font-medium shrink-0">
                      {s.tag}
                    </span>
                    <button
                      onClick={() => handleApproveSuggestion(s)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white
                                 font-semibold hover:bg-emerald-500 transition-colors shrink-0"
                    >
                      승인
                    </button>
                    <button
                      onClick={() => handleRejectSuggestion(s.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-stone-100 text-stone-600
                                 font-semibold hover:bg-stone-200 transition-colors shrink-0"
                    >
                      거절
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}


        {/* ════════ 배우 관리 탭 ════════ */}
        {tab === 'actors' && (
          <div className="space-y-4">

            {/* 배우 관리 서브탭 네비게이션 */}
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-1.5 flex gap-1">
              {[
                { key: 'review', icon: '🔍', label: '사진 검토',     count: pendingActors.length },
                { key: 'search', icon: '📸', label: '사진 직접 등록', count: null },
                { key: 'list',   icon: '👤', label: '배우 전체 목록', count: actorsList.length   },
              ].map(({ key, icon, label, count }) => (
                <button
                  key={key}
                  onClick={() => { setActorSubTab(key); setActorSearch(''); setActorPage(1) }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl
                              text-sm font-semibold transition-all ${
                    actorSubTab === key
                      ? 'bg-stone-900 text-white shadow-sm'
                      : 'text-stone-500 hover:bg-stone-50'
                  }`}
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                  {count > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                      actorSubTab === key ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-500'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              ))}
            </div>


            {/* ── 배우 이름 검색 + 정렬 (사진 검토 / 배우 전체 목록 탭에서만 표시) ── */}
            {(actorSubTab === 'review' || actorSubTab === 'list') && (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={actorSearch}
                    onChange={e => { setActorSearch(e.target.value); setActorPage(1) }}
                    placeholder="배우 이름 검색..."
                    className="w-full px-4 py-2.5 pr-9 rounded-xl border border-stone-200
                               text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
                  />
                  {actorSearch && (
                    <button
                      onClick={() => { setActorSearch(''); setActorPage(1) }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400
                                 hover:text-stone-600 text-lg leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
                <select
                  value={actorSort}
                  onChange={e => { setActorSort(e.target.value); setActorPage(1) }}
                  className="shrink-0 border border-stone-200 rounded-xl px-3 py-2 text-sm
                             bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 text-stone-600"
                >
                  <option value="name">가나다순</option>
                  <option value="shows">출연 공연 많은 순</option>
                </select>
              </div>
            )}

            {/* ── 사진 검토 서브탭 ── */}
            {/* pending_actors 컬렉션에서 검토 대기 항목을 표시 */}
            {actorSubTab === 'review' && (
              <div className="space-y-3">
                {/* 안내 문구 */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                  <strong>사진 검토</strong> — 플레이DB 자동 수집 중 판단이 어려운 배우 사진 목록입니다.
                  맞는 사진이면 ✅, 틀리면 ❌, URL을 직접 입력하려면 🔍를 클릭하세요.
                </div>

                {pendingActorsLoading ? (
                  <div className="animate-pulse space-y-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-28 bg-stone-100 rounded-2xl" />
                    ))}
                  </div>
                ) : pendingActors.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-stone-100 shadow-sm
                                  text-center py-16 text-stone-400">
                    <div className="text-5xl mb-3">✅</div>
                    <p className="font-medium text-stone-600">검토 대기 중인 사진이 없습니다</p>
                    <p className="text-sm mt-1">
                      get_actor_images_playdb.py 실행 후 pending_actors 컬렉션에 저장되면 여기에 표시됩니다
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(() => {
                      const filtered = pendingActors
                        .filter(p => !actorSearch.trim() || p.actorName?.includes(actorSearch.trim()))
                        .sort((a, b) => actorSort === 'shows'
                          ? (actorShowCountMap[b.actorName] ?? 0) - (actorShowCountMap[a.actorName] ?? 0)
                          : (a.actorName ?? '').localeCompare(b.actorName ?? '', 'ko'))
                      if (filtered.length === 0)
                        return <p className="text-center text-stone-400 text-sm py-8">검색 결과가 없어요</p>
                      const totalPages = Math.ceil(filtered.length / ACTORS_PER_PAGE)
                      const page = Math.min(actorPage, totalPages)
                      const paged = filtered.slice((page - 1) * ACTORS_PER_PAGE, page * ACTORS_PER_PAGE)
                      return (
                        <>
                          {paged.map(pending => (
                            <div key={pending.id}>
                              {actorSort === 'shows' && actorShowCountMap[pending.actorName] > 0 && (
                                <p className="text-xs text-stone-400 mb-1 pl-1">
                                  {actorShowCountMap[pending.actorName]}개 공연 출연
                                </p>
                              )}
                              <PendingActorCard
                                pending={pending}
                                currentShows={actorShowsMap[pending.actorName] ?? []}
                                onApprove={handleApprovePendingActor}
                                onReject={handleRejectPendingActor}
                              />
                            </div>
                          ))}
                          {totalPages > 1 && (
                            <div className="flex items-center justify-center gap-2 pt-2">
                              <button
                                onClick={() => setActorPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="px-3 py-1.5 text-sm rounded-lg border border-stone-200
                                           disabled:opacity-30 hover:bg-stone-50"
                              >←</button>
                              <span className="text-sm text-stone-500">
                                {page} / {totalPages}
                              </span>
                              <button
                                onClick={() => setActorPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="px-3 py-1.5 text-sm rounded-lg border border-stone-200
                                           disabled:opacity-30 hover:bg-stone-50"
                              >→</button>
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                )}
              </div>
            )}


            {/* ── 사진 직접 등록 서브탭 ── */}
            {actorSubTab === 'search' && (
              <ActorImageDirectUpload db={db} />
            )}

            {/* ── 배우 전체 목록 서브탭 ── */}
            {/* actors 컬렉션 전체 목록, 사진 없는 배우는 흐릿하게 표시 */}
            {actorSubTab === 'list' && (
              <div className="space-y-3">
                {/* 안내 문구 + 토스트 */}
                <div className="flex items-center justify-between gap-3">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex-1">
                    <strong>배우 전체 목록</strong> — 사진 없는 배우는 흐릿하게 표시됩니다.
                  </div>
                  {actorListToast && (
                    <span className="text-sm font-semibold text-emerald-600 shrink-0 animate-pulse">
                      {actorListToast}
                    </span>
                  )}
                </div>

                {actorsLoading ? (
                  <div className="animate-pulse space-y-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-24 bg-stone-100 rounded-2xl" />
                    ))}
                  </div>
                ) : actorsList.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-stone-100 shadow-sm
                                  text-center py-16 text-stone-400">
                    <div className="text-5xl mb-3">👤</div>
                    <p className="font-medium text-stone-600 mb-1">등록된 배우가 없습니다</p>
                    <p className="text-sm">actors 컬렉션에 배우 문서가 없습니다</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(() => {
                      const filtered = actorsList
                        .filter(a => !actorSearch.trim() || a.name?.includes(actorSearch.trim()))
                        .sort((a, b) => actorSort === 'shows'
                          ? (actorShowCountMap[b.name] ?? 0) - (actorShowCountMap[a.name] ?? 0)
                          : (a.name ?? '').localeCompare(b.name ?? '', 'ko'))
                      if (filtered.length === 0)
                        return <p className="text-center text-stone-400 text-sm py-8">검색 결과가 없어요</p>
                      const totalPages = Math.ceil(filtered.length / ACTORS_PER_PAGE)
                      const page = Math.min(actorPage, totalPages)
                      const paged = filtered.slice((page - 1) * ACTORS_PER_PAGE, page * ACTORS_PER_PAGE)
                      return (
                        <>
                          {paged.map(actor => {
                      const edit       = actorEdits[actor.id] ?? {}
                      const currentUrl = edit.imageUrl !== undefined ? edit.imageUrl : (actor.imageUrl ?? '')
                      const saving     = edit._saving  ?? false
                      const hasImage   = !!currentUrl.trim()
                      const isOpen     = actorEditOpen === actor.id
                      // pendingActors에서 이 배우와 일치하는 항목 찾기
                      const pendingMatch = pendingActors.find(p => p.actorName === actor.name)

                      async function handleSaveUrl() {
                        const url = currentUrl.trim()
                        if (!url) return
                        setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _saving: true } }))
                        try {
                          await updateDoc(doc(db, 'actors', actor.id), { imageUrl: url })
                          setActorsList(prev => prev.map(a => a.id === actor.id ? { ...a, imageUrl: url } : a))
                          setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _saving: false } }))
                          setActorEditOpen(null)
                          showActorListToast('사진이 변경됐어요 🙌')
                        } catch (err) {
                          console.error(err)
                          alert('저장 중 오류가 발생했습니다.')
                          setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _saving: false } }))
                        }
                      }

                      async function handleSelectCandidate(imgUrl) {
                        setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _saving: true } }))
                        try {
                          await updateDoc(doc(db, 'actors', actor.id), { imageUrl: imgUrl })
                          setActorsList(prev => prev.map(a => a.id === actor.id ? { ...a, imageUrl: imgUrl } : a))
                          setActorEdits(prev => ({ ...prev, [actor.id]: { imageUrl: imgUrl, _saving: false } }))
                          setActorEditOpen(null)
                          showActorListToast('사진이 변경됐어요 🙌')
                        } catch (err) {
                          console.error(err)
                          alert('저장 중 오류가 발생했습니다.')
                          setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _saving: false } }))
                        }
                      }

                      async function handleDeleteImage() {
                        if (!window.confirm(`「${actor.name}」의 사진을 삭제할까요?`)) return
                        setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _saving: true } }))
                        try {
                          await updateDoc(doc(db, 'actors', actor.id), { imageUrl: '' })
                          setActorsList(prev => prev.map(a => a.id === actor.id ? { ...a, imageUrl: '' } : a))
                          setActorEdits(prev => ({ ...prev, [actor.id]: { imageUrl: '', _saving: false } }))
                          setActorEditOpen(null)
                          showActorListToast('사진을 삭제했어요')
                        } catch (err) {
                          console.error(err)
                          alert('삭제 중 오류가 발생했습니다.')
                          setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _saving: false } }))
                        }
                      }

                      return (
                        <div key={actor.id}
                             className={`bg-white rounded-2xl border border-stone-100 shadow-sm p-4
                                         transition-opacity
                                         ${!hasImage ? 'opacity-50 hover:opacity-90' : ''}`}>
                          {/* 기본 행: 사진 + 이름 + 사진 변경 버튼 */}
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-xl overflow-hidden bg-stone-100 shrink-0
                                            flex items-center justify-center">
                              {currentUrl ? (
                                <img src={toHttps(currentUrl)} alt={actor.name}
                                     className="w-full h-full object-cover"
                                     onError={e => { e.target.style.display = 'none' }} />
                              ) : (
                                <span className="text-xl text-stone-400">{actor.name?.[0] ?? '?'}</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-semibold text-stone-800 text-sm">{actor.name}</p>
                                <a
                                  href={actor.profileUrl || `https://www.playdb.co.kr/people/search?keyword=${encodeURIComponent(actor.name)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-500 hover:underline shrink-0"
                                >
                                  플레이DB 프로필 보기 →
                                </a>
                              </div>
                              {(actorShowsMap[actor.name]?.length ?? 0) > 0 ? (
                                <p className="text-xs text-stone-400 mt-0.5 truncate">
                                  {actorShowsMap[actor.name].join(' · ')}
                                </p>
                              ) : (
                                <p className="text-xs text-stone-300 mt-0.5">출연 공연 없음</p>
                              )}
                            </div>
                            <button
                              onClick={() => setActorEditOpen(isOpen ? null : actor.id)}
                              className={`shrink-0 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                                isOpen
                                  ? 'bg-stone-900 text-white border-stone-900'
                                  : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                              }`}
                            >
                              {isOpen ? '닫기' : '사진 변경'}
                            </button>
                          </div>

                          {/* 펼쳐진 옵션 패널 */}
                          {isOpen && (
                            <div className="mt-3 pt-3 border-t border-stone-100 space-y-3">

                              {/* 옵션 1: URL 직접 입력 */}
                              <div>
                                <p className="text-xs font-semibold text-stone-500 mb-1.5">1. URL 직접 입력</p>
                                <div className="flex gap-2">
                                  <input
                                    type="url"
                                    value={currentUrl}
                                    onChange={e => setActorEdits(prev => ({
                                      ...prev,
                                      [actor.id]: { ...prev[actor.id], imageUrl: e.target.value },
                                    }))}
                                    placeholder="이미지 URL 입력..."
                                    className={`${INPUT} flex-1 text-xs`}
                                  />
                                  <button
                                    onClick={handleSaveUrl}
                                    disabled={saving || !currentUrl.trim()}
                                    className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg
                                               bg-emerald-600 text-white hover:bg-emerald-500
                                               disabled:opacity-40 transition-colors"
                                  >
                                    {saving ? '저장 중...' : '저장'}
                                  </button>
                                </div>
                              </div>

                              {/* 옵션 2: 플레이DB 후보 */}
                              <div>
                                <p className="text-xs font-semibold text-stone-500 mb-1.5">2. 플레이DB 후보</p>
                                {pendingMatch ? (
                                  <div className="space-y-2">
                                    {/* 후보 버튼들 */}
                                    {(pendingMatch.candidates?.length ?? 0) > 0 ? (
                                      <div className="flex gap-2 flex-wrap">
                                        {pendingMatch.candidates.map((c, i) => (
                                          <div key={i} className="flex flex-col items-start">
                                            <button
                                              onClick={() => handleSelectCandidate(c.imageUrl)}
                                              disabled={saving}
                                              className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg
                                                         border border-stone-200 bg-stone-50 hover:bg-amber-50
                                                         hover:border-amber-300 transition-colors disabled:opacity-40"
                                            >
                                              {c.imageUrl && (
                                                <img src={toHttps(c.imageUrl)} alt={c.name}
                                                     className="w-8 h-8 rounded-lg object-cover"
                                                     onError={e => { e.target.style.display = 'none' }} />
                                              )}
                                              <span>{c.name} ({i + 1}순위)</span>
                                            </button>
                                            {c.shows?.length > 0 && (
                                              <p className="text-[11px] text-stone-400 mt-0.5 pl-1">
                                                {c.shows.slice(0, 2).join(', ')}
                                              </p>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : pendingMatch.imageUrl ? (
                                      <button
                                        onClick={() => handleSelectCandidate(pendingMatch.imageUrl)}
                                        disabled={saving}
                                        className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg
                                                   border border-stone-200 bg-stone-50 hover:bg-amber-50
                                                   hover:border-amber-300 transition-colors disabled:opacity-40"
                                      >
                                        <img src={toHttps(pendingMatch.imageUrl)} alt={actor.name}
                                             className="w-8 h-8 rounded-lg object-cover"
                                             onError={e => { e.target.style.display = 'none' }} />
                                        <span>플레이DB 수집 사진 사용</span>
                                      </button>
                                    ) : (
                                      <p className="text-xs text-stone-400">수집된 후보 사진이 없습니다.</p>
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-xs text-stone-400">
                                    사진 검토 탭에서 검색하세요.
                                    (get_actor_images_playdb.py 실행 후 pending_actors에 저장된 경우 여기에 표시됩니다)
                                  </p>
                                )}
                              </div>

                              {/* 옵션 3: 사진 삭제 */}
                              <div className="pt-1">
                                <button
                                  onClick={handleDeleteImage}
                                  disabled={saving || !hasImage}
                                  className="text-xs px-3 py-1.5 rounded-lg border border-red-200
                                             text-red-500 hover:bg-red-50 transition-colors
                                             disabled:opacity-30"
                                >
                                  🗑 사진 삭제
                                </button>
                              </div>

                            </div>
                          )}
                        </div>
                          )
                          })}
                          {totalPages > 1 && (
                            <div className="flex items-center justify-center gap-2 pt-2">
                              <button
                                onClick={() => setActorPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="px-3 py-1.5 text-sm rounded-lg border border-stone-200
                                           disabled:opacity-30 hover:bg-stone-50"
                              >←</button>
                              <span className="text-sm text-stone-500">
                                {page} / {totalPages}
                              </span>
                              <button
                                onClick={() => setActorPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="px-3 py-1.5 text-sm rounded-lg border border-stone-200
                                           disabled:opacity-30 hover:bg-stone-50"
                              >→</button>
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                )}
              </div>
            )}

          </div>
        )}


        {/* ════════ 캐스팅 탭 ════════ */}
        {tab === 'casting' && (
          <CastingTab db={db} showsList={showsList} />
        )}

      </div>
    </div>
  )
}


// ══════════════════════════════════════════════
// ActorImageDirectUpload — 배우 이름 검색 후 사진 URL 직접 등록
// ══════════════════════════════════════════════
function ActorImageDirectUpload({ db }) {
  const [searchTerm,  setSearchTerm]  = useState('')
  const [results,     setResults]     = useState([])
  const [searching,   setSearching]   = useState(false)
  // { [actorId]: { url, saving, saved, open } }
  const [edits,       setEdits]       = useState({})
  const [toast,       setToast]       = useState('')

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  useEffect(() => {
    const term = searchTerm.trim()
    if (!term) { setResults([]); return }
    if (!isFirebaseConfigured || !db) return
    setSearching(true)
    getDocs(query(collection(db, 'actors'), where('name', '>=', term), where('name', '<=', term + '\uf8ff')))
      .then(snap => {
        setResults(snap.docs.map(d => ({ id: d.id, ...d.data() })).slice(0, 10))
      })
      .finally(() => setSearching(false))
  }, [searchTerm, db])

  function toggleOpen(actorId, currentUrl) {
    setEdits(prev => ({
      ...prev,
      [actorId]: {
        url:    prev[actorId]?.url ?? currentUrl ?? '',
        open:   !prev[actorId]?.open,
        saving: false,
        saved:  false,
      },
    }))
  }

  async function handleSave(actor) {
    const url = (edits[actor.id]?.url ?? '').trim()
    if (!url || !db) return
    setEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], saving: true, saved: false } }))
    try {
      await updateDoc(doc(db, 'actors', actor.id), { imageUrl: url })
      setResults(prev => prev.map(a => a.id === actor.id ? { ...a, imageUrl: url } : a))
      setEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], saving: false, saved: true, open: false } }))
      showToast('사진이 등록됐어요 🙌')
    } catch (e) {
      alert('저장 실패: ' + e.message)
      setEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], saving: false } }))
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
        <strong>사진 직접 등록</strong> — 배우 이름으로 검색한 뒤 사진 URL을 직접 입력해 저장합니다.
      </div>

      {/* 검색창 */}
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="배우 이름 검색..."
          className={INPUT}
        />
        {searching && (
          <span className="absolute right-3 top-2.5 text-xs text-stone-400 pointer-events-none">검색 중...</span>
        )}
      </div>

      {/* 검색 결과 */}
      {results.length > 0 && (
        <div className="space-y-3">
          {results.map(actor => {
            const edit    = edits[actor.id] ?? {}
            const imgSrc  = toHttps(actor.imageUrl ?? '')
            return (
              <div key={actor.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 space-y-3">
                <div className="flex items-center gap-3">
                  {/* 현재 사진 */}
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-stone-100 shrink-0 flex items-center justify-center">
                    {imgSrc ? (
                      <img src={imgSrc} alt={actor.name} className="w-full h-full object-cover"
                           onError={e => { e.target.style.display = 'none' }} />
                    ) : (
                      <span className="text-xl text-stone-400">{actor.name?.[0]}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-stone-800 text-sm">{actor.name}</p>
                    {actor.imageUrl ? (
                      <p className="text-xs text-stone-400 truncate">{actor.imageUrl}</p>
                    ) : (
                      <p className="text-xs text-stone-300">사진 없음</p>
                    )}
                  </div>
                  <button
                    onClick={() => toggleOpen(actor.id, actor.imageUrl)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg
                               bg-stone-100 text-stone-600 hover:bg-amber-100 hover:text-amber-700
                               transition-colors shrink-0"
                  >
                    📸 사진 URL 직접 입력
                  </button>
                </div>

                {/* URL 입력창 (토글) */}
                {edit.open && (
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={edit.url ?? ''}
                      onChange={e => setEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], url: e.target.value } }))}
                      placeholder="https://..."
                      className="flex-1 border border-stone-200 rounded-lg px-3 py-2 text-sm
                                 focus:outline-none focus:ring-2 focus:ring-amber-300 placeholder:text-stone-300"
                    />
                    <button
                      onClick={() => handleSave(actor)}
                      disabled={edit.saving || !edit.url?.trim()}
                      className="px-4 py-2 text-xs font-semibold rounded-lg
                                 bg-emerald-600 text-white hover:bg-emerald-500
                                 disabled:opacity-40 transition-colors shrink-0"
                    >
                      {edit.saving ? '저장 중...' : '저장'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {searchTerm.trim() && !searching && results.length === 0 && (
        <p className="text-sm text-stone-400 text-center py-6">검색 결과가 없어요</p>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                        bg-stone-900 text-white text-sm px-5 py-3 rounded-2xl shadow-xl
                        animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  )
}


// ══════════════════════════════════════════════
// CastingTab — 캐스팅 업로드 + 이벤트 캘린더 등록
// ══════════════════════════════════════════════
function CastingTab({ db, showsList }) {
  return (
    <div className="space-y-6">
      <CastingUploadSection db={db} showsList={showsList} />
      <CastingEventSection  db={db} showsList={showsList} />
    </div>
  )
}


// ── [섹션 1] 캐스팅 사진 분석 ──────────────────
const WORKER_URL = 'https://playpick-ai-v2.merhen08.workers.dev/casting'

function CastingUploadSection({ db, showsList = [] }) {
  const [file,           setFile]           = useState(null)
  const [preview,        setPreview]        = useState('')
  const [analyzing,      setAnalyzing]      = useState(false)
  const [rows,           setRows]           = useState(null)   // null=미분석, []이상=분석완료
  const [saving,         setSaving]         = useState(false)
  const [toast,          setToast]          = useState('')
  const [error,          setError]          = useState('')
  const [rawResponse,    setRawResponse]    = useState('')   // Worker 원본 응답
  const [selectedShowId, setSelectedShowId] = useState('')
  const dropRef = useRef(null)

  // 선택한 공연의 cast 배열
  const selectedShow = showsList.find(s => s.id === selectedShowId) ?? null
  const castList = (selectedShow?.cast ?? []).map(c => ({
    actorName: c.actorName,
    roleName:  c.roleName ?? '',
  }))

  function handleFile(f) {
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setRows(null)
    setError('')
    setToast('')
  }

  function onDrop(e) {
    e.preventDefault()
    handleFile(e.dataTransfer.files[0])
  }

  // Worker 응답에서 rows 배열 추출
  function extractRows(data) {
    if (Array.isArray(data))       return data
    if (Array.isArray(data.rows))  return data.rows
    if (Array.isArray(data.casts)) return data.casts
    if (Array.isArray(data.results)) return data.results
    for (const v of Object.values(data)) {
      if (Array.isArray(v)) return v
    }
    return []
  }

  async function analyze() {
    if (!file) return
    setAnalyzing(true)
    setError('')
    setRawResponse('')
    setRows(null)
    setToast('')
    try {
      const b64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = e => resolve(e.target.result.split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      console.log('base64 길이:', b64.length)
      console.log('base64 앞 100자:', b64.substring(0, 100))
      console.log('mimeType:', file.type)
      // castList를 함께 전송 — Worker가 역할명 매칭에 활용
      const body = { imageBase64: b64, mimeType: file.type }
      if (castList.length > 0) body.castList = castList
      if (selectedShow)        body.showTitle = selectedShow.title
      console.log('Worker로 전송 중...')
      const res = await fetch(WORKER_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const text = await res.text()
      setRawResponse(text)
      if (!res.ok) throw new Error(`Worker 오류 ${res.status}: ${text.slice(0, 200)}`)
      let data
      try { data = JSON.parse(text) } catch { throw new Error(`JSON 파싱 실패`) }
      const extracted = extractRows(data)
      const normalized = extracted.map(r => ({
        date:      r.date      ?? '',
        showTitle: r.showTitle ?? r.show_title ?? r.title ?? selectedShow?.title ?? '',
        actorName: r.actorName ?? r.actor_name ?? r.actor ?? '',
        roleName:  r.roleName  ?? r.role_name  ?? r.role  ?? '',
      }))
      setRows(normalized)
    } catch (e) {
      console.error('[Casting 분석 오류]', e)
      setError(e.message)
      setRows([])
    } finally {
      setAnalyzing(false)
    }
  }

  function updateRow(i, field, val) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  function addRow() {
    setRows(prev => [...prev, { date: '', showTitle: '', actorName: '', roleName: '' }])
  }

  function removeRow(i) {
    setRows(prev => prev.filter((_, idx) => idx !== i))
  }

  async function saveToFirestore() {
    if (!rows?.length || !db) return
    setSaving(true)
    setToast('')
    try {
      const grouped = {}
      rows.forEach(r => {
        const key = `${(r.showTitle || 'unknown').replace(/\s/g, '_')}_${r.date || 'nodate'}`
        if (!grouped[key]) grouped[key] = { date: r.date, showTitle: r.showTitle, entries: [] }
        grouped[key].entries.push({ actorName: r.actorName, role: r.roleName })
      })
      const batch = writeBatch(db)
      Object.entries(grouped).forEach(([docId, data]) => {
        const ref = doc(db, 'dailyCasts', docId)
        batch.set(ref, { ...data, createdAt: serverTimestamp() }, { merge: true })
      })
      await batch.commit()
      setToast(`캐스팅이 등록됐어요 🎭`)
      setTimeout(() => setToast(''), 3000)
    } catch (e) {
      setError(`저장 실패: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6 space-y-5">
      <h3 className="font-bold text-stone-700">🎬 캐스팅 사진 분석</h3>

      {/* 공연 선택 */}
      <div className="space-y-1">
        <label className={LABEL}>공연 선택 (선택 시 cast 데이터로 역할명 자동 매칭)</label>
        <select
          value={selectedShowId}
          onChange={e => setSelectedShowId(e.target.value)}
          className={INPUT}
        >
          <option value="">— 공연 선택 안 함</option>
          {showsList
            .slice()
            .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', 'ko'))
            .map(s => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
        </select>
        {selectedShow && castList.length > 0 && (
          <p className="text-xs text-stone-400">
            cast {castList.length}명 로드됨 —{' '}
            {castList.slice(0, 3).map(c => c.actorName).join(', ')}
            {castList.length > 3 ? ` 외 ${castList.length - 3}명` : ''}
          </p>
        )}
      </div>

      {/* 업로드 영역 */}
      <div
        ref={dropRef}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => dropRef.current.querySelector('input').click()}
        className="border-2 border-dashed border-stone-200 rounded-xl p-8 text-center cursor-pointer
                   hover:border-amber-300 hover:bg-amber-50/30 transition-colors"
      >
        <input type="file" accept="image/*" className="hidden"
               onChange={e => handleFile(e.target.files[0])} />
        {preview ? (
          <img src={preview} alt="미리보기" className="max-h-48 mx-auto rounded-lg object-contain" />
        ) : (
          <div className="space-y-1">
            <p className="text-3xl">🖼️</p>
            <p className="text-sm text-stone-400">클릭하거나 이미지를 드래그하세요</p>
          </div>
        )}
      </div>

      {file && (
        <p className="text-xs text-stone-400">{file.name} ({(file.size / 1024).toFixed(0)} KB)</p>
      )}

      {/* 분석 버튼 */}
      <div className="flex items-center gap-3">
        <button
          onClick={analyze}
          disabled={!file || analyzing}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold
                     hover:bg-amber-400 disabled:opacity-40 transition-colors"
        >
          {analyzing && (
            <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          {analyzing ? '분석 중...' : 'Gemini로 분석하기'}
        </button>
        {analyzing && <span className="text-xs text-stone-400 animate-pulse">이미지를 분석하고 있어요</span>}
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Worker 원본 응답 (rows가 비거나 에러 시 항상 표시) */}
      {rawResponse && (Array.isArray(rows) && rows.length === 0 || error) && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-stone-400">Worker 원본 응답</p>
          <pre className="bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-xs text-stone-600
                          overflow-x-auto whitespace-pre-wrap break-all">
            {rawResponse}
          </pre>
        </div>
      )}

      {/* 분석 결과 테이블 */}
      {Array.isArray(rows) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-stone-500 font-semibold">
              분석 결과 — {rows.length}행{rows.length > 0 ? ', 수정 후 저장하세요' : ''}
            </p>
            <button onClick={addRow}
                    className="text-xs text-amber-600 hover:text-amber-500 font-medium">
              + 행 추가
            </button>
          </div>

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-stone-100">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-100">
                    {['날짜', '공연명', '배우명', '역할', ''].map((h, i) => (
                      <th key={i} className="text-left text-xs font-semibold text-stone-400 px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-b border-stone-50 last:border-0">
                      {['date', 'showTitle', 'actorName', 'roleName'].map(field => (
                        <td key={field} className="px-2 py-1.5">
                          <input
                            value={row[field] ?? ''}
                            onChange={e => updateRow(i, field, e.target.value)}
                            className="w-full border border-stone-200 rounded-lg px-2 py-1 text-xs
                                       focus:outline-none focus:ring-1 focus:ring-amber-300 bg-white"
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        <button onClick={() => removeRow(i)}
                                className="text-stone-300 hover:text-red-400 text-xs transition-colors">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={saveToFirestore}
              disabled={saving || !rows.length}
              className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold
                         hover:bg-emerald-500 disabled:opacity-40 transition-colors"
            >
              {saving ? '저장 중...' : 'Firestore 저장'}
            </button>
            {toast && (
              <span className="text-sm font-medium text-emerald-600 animate-pulse">{toast}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


// ── [섹션 2] 이벤트 캘린더 등록 ────────────────
function CastingEventSection({ db, showsList }) {
  const [date,      setDate]      = useState('')
  const [label,     setLabel]     = useState('')
  const [showId,    setShowId]    = useState('')
  const [saving,    setSaving]    = useState(false)
  const [events,    setEvents]    = useState([])   // [{ docId, date, events: [{label, showId?, showTitle?}] }]
  const [loadingEv, setLoadingEv] = useState(true)

  // 이벤트 목록 로드
  useEffect(() => {
    if (!db) { setLoadingEv(false); return }
    getDocs(query(collection(db, 'castingEvents'), orderBy('date', 'desc')))
      .then(snap => setEvents(snap.docs.map(d => ({ docId: d.id, ...d.data() }))))
      .finally(() => setLoadingEv(false))
  }, [db])

  async function handleAdd() {
    if (!date || !label.trim() || !db) return
    setSaving(true)
    try {
      const selectedShow = showsList.find(s => s.id === showId)
      const newEntry = {
        label: label.trim(),
        ...(selectedShow ? { showId: selectedShow.id, showTitle: selectedShow.title } : {}),
      }
      const ref = doc(db, 'castingEvents', date)
      await setDoc(ref, {
        date,
        events: arrayUnion(newEntry),
      }, { merge: true })

      // 로컬 상태 업데이트
      setEvents(prev => {
        const idx = prev.findIndex(e => e.date === date)
        if (idx >= 0) {
          const updated = [...prev]
          updated[idx] = {
            ...updated[idx],
            events: [...(updated[idx].events ?? []), newEntry],
          }
          return updated
        }
        return [{ docId: date, date, events: [newEntry] }, ...prev]
      })
      setLabel('')
      setShowId('')
    } catch (e) {
      alert('저장 실패: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteEvent(docId, entryIdx) {
    if (!db) return
    const target = events.find(e => e.docId === docId)
    if (!target) return
    const newEntries = target.events.filter((_, i) => i !== entryIdx)
    try {
      if (newEntries.length === 0) {
        await deleteDoc(doc(db, 'castingEvents', docId))
        setEvents(prev => prev.filter(e => e.docId !== docId))
      } else {
        await setDoc(doc(db, 'castingEvents', docId), { ...target, events: newEntries })
        setEvents(prev => prev.map(e => e.docId === docId ? { ...e, events: newEntries } : e))
      }
    } catch (e) {
      alert('삭제 실패: ' + e.message)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6 space-y-5">
      <h3 className="font-bold text-stone-700">📅 이벤트 캘린더 등록</h3>

      {/* 입력 폼 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-semibold text-stone-500 mb-1">날짜</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-stone-500 mb-1">이벤트명</label>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="예: 커튼콜 데이, 마지막 공연"
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-amber-300 placeholder:text-stone-300"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-stone-500 mb-1">공연 (선택)</label>
          <select
            value={showId}
            onChange={e => setShowId(e.target.value)}
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
          >
            <option value="">— 공통 이벤트</option>
            {showsList.map(s => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        onClick={handleAdd}
        disabled={!date || !label.trim() || saving}
        className="px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold
                   hover:bg-amber-400 disabled:opacity-40 transition-colors"
      >
        {saving ? '등록 중...' : '등록'}
      </button>

      {/* 등록된 이벤트 목록 */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-stone-500">등록된 이벤트</p>
        {loadingEv ? (
          <p className="text-sm text-stone-400">불러오는 중...</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-stone-400">등록된 이벤트가 없어요</p>
        ) : (
          events.map(ev => (
            <div key={ev.docId} className="border border-stone-100 rounded-xl px-4 py-3 space-y-1.5">
              <p className="text-xs font-bold text-stone-500">{ev.date}</p>
              {(ev.events ?? []).map((entry, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-stone-700">{entry.label}</span>
                    {entry.showTitle && (
                      <span className="text-xs text-stone-400">({entry.showTitle})</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteEvent(ev.docId, i)}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors"
                  >삭제</button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
