// ─────────────────────────────────────────────
// AdminPage.jsx — 관리자 페이지
// ─────────────────────────────────────────────
// 탭 구성:
//   - 대기 중    : pending 컬렉션, 리스트 행 + 사이드 패널 수정
//   - 공연 추가  : 폼 입력 → pending 저장
//   - 등록 완료  : shows 컬렉션, 카드 수정/삭제
// ─────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
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

  return (
    <div className="space-y-3">
      <label className={LABEL}>출연진</label>

      {/* 기존 출연진 태그 목록 */}
      {cast.length > 0 && (
        <div className="space-y-2">
          {cast.map((c, idx) => (
            <div key={idx}
                 className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-xl p-2">
              {/* 배우 사진 */}
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-stone-200 shrink-0
                              flex items-center justify-center">
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt={c.actorName}
                       className="w-full h-full object-cover"
                       onError={e => { e.target.style.display = 'none' }} />
                ) : (
                  <span className="text-base font-bold text-stone-400">{c.actorName?.[0]}</span>
                )}
              </div>
              {/* 배우 이름 */}
              <span className="text-sm font-semibold text-stone-800 w-16 shrink-0 truncate">
                {c.actorName}
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
              <label className="flex items-center gap-1 text-xs text-stone-500 shrink-0 cursor-pointer select-none">
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
          ))}
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
            const imgSrc  = actor.imageUrl ||
              (wikiImg && wikiImg !== 'loading' && wikiImg !== 'none' ? wikiImg : null)
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
// links: [{ site, url }]
// onChange: (newLinks) => void
function TicketLinksSection({ links, onChange }) {
  // 개별 링크 필드 수정
  function updateLink(idx, field, value) {
    onChange(links.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }

  // 새 빈 링크 추가
  function addLink() {
    onChange([...links, { site: '', url: '' }])
  }

  // 링크 삭제
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
          + 추가
        </button>
      </div>

      {links.length === 0 && (
        <p className="text-xs text-stone-400">
          티켓 링크가 없습니다. + 추가 버튼으로 입력하세요.
        </p>
      )}

      {links.map((link, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          {/* 사이트명 입력 */}
          <input
            type="text"
            value={link.site}
            onChange={e => updateLink(idx, 'site', e.target.value)}
            placeholder="인터파크"
            className="w-24 shrink-0 border border-stone-200 rounded-lg px-2 py-2 text-xs bg-white
                       focus:outline-none focus:ring-1 focus:ring-amber-300 placeholder:text-stone-300"
          />
          {/* URL 입력 */}
          <input
            type="url"
            value={link.url}
            onChange={e => updateLink(idx, 'url', e.target.value)}
            placeholder="https://..."
            className="flex-1 border border-stone-200 rounded-lg px-2 py-2 text-xs bg-white
                       focus:outline-none focus:ring-1 focus:ring-amber-300 placeholder:text-stone-300"
          />
          {/* X 삭제 버튼 */}
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


// ── 공연 정보 편집 폼 (대기 중 · 등록 완료 공통) ──
function ShowEditForm({ draft, onChangeDraft, onSave, onCancel }) {
  const [synopsisLoading, setSynopsisLoading] = useState(false)

  // sourceUrl에서 mt20id 파싱 (예: ...?pc=02&mt20id=PF12345)
  const mt20id = draft.sourceUrl
    ? new URLSearchParams(draft.sourceUrl.split('?')[1] ?? '').get('mt20id')
    : null

  async function handleFetchSynopsis() {
    if (!mt20id) return
    const apiKey = import.meta.env.VITE_KOPIS_API_KEY
    if (!apiKey) { alert('VITE_KOPIS_API_KEY 환경변수가 설정되지 않았습니다.'); return }
    setSynopsisLoading(true)
    try {
      const res = await fetch(
        `https://www.kopis.or.kr/openApi/restful/pblprfr/${mt20id}?service=${apiKey}`
      )
      const text = await res.text()
      const parser = new DOMParser()
      const xml = parser.parseFromString(text, 'text/xml')
      const sty = xml.querySelector('sty')?.textContent?.trim() ?? ''
      if (sty) {
        onChangeDraft('synopsis', sty)
      } else {
        alert('KOPIS에서 시놉시스 정보를 찾을 수 없습니다.')
      }
    } catch (err) {
      console.error('KOPIS 시놉시스 불러오기 실패:', err)
      alert('불러오기 중 오류가 발생했습니다.')
    } finally {
      setSynopsisLoading(false)
    }
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
              disabled={synopsisLoading}
              className="text-xs px-2.5 py-1 rounded-lg bg-stone-100 text-stone-600
                         hover:bg-stone-200 transition-colors disabled:opacity-50"
            >
              {synopsisLoading ? '불러오는 중…' : 'KOPIS에서 불러오기'}
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
            src={show.imageUrl}
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
function SortableCastItem({ c, onRemove }) {
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
      {c.actorImage ? (
        <img src={c.actorImage} alt={c.actorName} className="w-6 h-6 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-6 h-6 rounded-full bg-amber-200 shrink-0 flex items-center justify-center font-bold text-amber-700">
          {c.actorName?.[0]}
        </div>
      )}
      <span className="font-medium text-stone-800">{c.actorName}</span>
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

  return (
    <div className="space-y-3">
      <label className={LABEL}>출연진</label>

      {/* 이미 추가된 배우 태그 목록 (드래그로 순서 변경 가능) */}
      {cast.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={cast.map(c => c.actorId || `name_${c.actorName}`)} strategy={horizontalListSortingStrategy}>
            <div className="flex flex-wrap gap-2">
              {cast.map(c => (
                <SortableCastItem key={c.actorId} c={c} onRemove={removeCast} />
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
function PendingActorCard({ pending, onApprove, onReject }) {
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
            <img src={displayUrl} alt={pending.actorName}
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
                <button
                  key={i}
                  onClick={() => { setSelectedUrl(c.imageUrl); setCustomMode(false) }}
                  className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                    !customMode && selectedUrl === c.imageUrl
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  {c.name} ({i + 1}순위)
                </button>
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
  const [addForm,   setAddForm]   = useState({ ...EMPTY_FORM })
  const [addStatus, setAddStatus] = useState(null)   // { type, msg }
  const [addLoading, setAddLoading] = useState(false)
  // 공연 추가 폼 - 출연진 목록: [{ actorId, actorName, actorImage, role }]
  const [addCast,   setAddCast]   = useState([])

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
      await setDoc(doc(db, 'pending', id), {
        ...addForm,
        tags,
        id,
        runtime:     addForm.runtime ? Number(addForm.runtime) : null,
        // 출연진 저장 (이미지 URL 포함)
        cast:        addCast,
        status:      'pending',
        collectedAt: serverTimestamp(),
      })
      setAddStatus({ type: 'success', msg: `「${addForm.title}」이(가) 대기열에 추가됐습니다. 대기 중 탭에서 승인해주세요.` })
      setAddForm({ ...EMPTY_FORM })
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
      await updateDoc(doc(db, 'actors', pending.actorId), { imageUrl: imageUrl.trim() })
      await deleteDoc(doc(db, 'pending_actors', pending.id))
      setPendingActors(prev => prev.filter(p => p.id !== pending.id))
      // 배우 전체 목록 탭에도 즉시 반영
      setActorsList(prev =>
        prev.map(a => a.id === pending.actorId ? { ...a, imageUrl: imageUrl.trim() } : a)
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
                  <label className={LABEL}>티켓 URL</label>
                  <input
                    value={addForm.ticketUrl}
                    onChange={e => setAddForm(f => ({ ...f, ticketUrl: e.target.value }))}
                    placeholder="https://..."
                    className={INPUT}
                  />
                </div>
              </div>

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
                { key: 'list',   icon: '👤', label: '배우 전체 목록', count: actorsList.length   },
              ].map(({ key, icon, label, count }) => (
                <button
                  key={key}
                  onClick={() => setActorSubTab(key)}
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
                    {pendingActors.map(pending => (
                      <PendingActorCard
                        key={pending.id}
                        pending={pending}
                        onApprove={handleApprovePendingActor}
                        onReject={handleRejectPendingActor}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}


            {/* ── 배우 전체 목록 서브탭 ── */}
            {/* actors 컬렉션 전체 목록, 사진 없는 배우는 흐릿하게 표시 */}
            {actorSubTab === 'list' && (
              <div className="space-y-3">
                {/* 안내 문구 */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                  <strong>배우 전체 목록</strong> — actors 컬렉션에 등록된 배우 사진을 수정합니다.
                  사진 없는 배우는 흐릿하게 표시됩니다. 사진을 클릭하면 URL 입력칸으로 이동합니다.
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
                    {actorsList.map(actor => {
                      const edit       = actorEdits[actor.id] ?? {}
                      const currentUrl = edit.imageUrl !== undefined ? edit.imageUrl : (actor.imageUrl ?? '')
                      const saving     = edit._saving  ?? false
                      const wikiing    = edit._wikiing ?? false
                      const saved      = edit._saved   ?? false
                      // 사진 없는 배우 여부 (흐릿하게 표시하기 위한 판별)
                      const hasImage   = !!currentUrl.trim()

                      async function handleSaveImage() {
                        if (!currentUrl.trim()) return
                        setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _saving: true, _saved: false } }))
                        try {
                          await updateDoc(doc(db, 'actors', actor.id), { imageUrl: currentUrl.trim() })
                          setActorsList(prev => prev.map(a => a.id === actor.id ? { ...a, imageUrl: currentUrl.trim() } : a))
                          setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _saving: false, _saved: true } }))
                          setTimeout(() => setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _saved: false } })), 2000)
                        } catch (err) {
                          console.error('배우 사진 저장 오류:', err)
                          alert('저장 중 오류가 발생했습니다.')
                          setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _saving: false } }))
                        }
                      }

                      async function handleWikiSearch() {
                        setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _wikiing: true } }))
                        try {
                          const r = await fetch(
                            `https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(actor.name)}`
                          )
                          if (r.ok) {
                            const data = await r.json()
                            const imgUrl = data?.thumbnail?.source?.replace(/\/\d+px-/, '/800px-') ?? ''
                            if (imgUrl) {
                              setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], imageUrl: imgUrl, _wikiing: false } }))
                            } else {
                              alert(`「${actor.name}」위키백과에 사진이 없습니다.`)
                              setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _wikiing: false } }))
                            }
                          } else {
                            alert(`「${actor.name}」위키백과 문서를 찾을 수 없습니다.`)
                            setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _wikiing: false } }))
                          }
                        } catch (err) {
                          console.error('위키백과 검색 오류:', err)
                          alert('위키백과 검색 중 오류가 발생했습니다.')
                          setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], _wikiing: false } }))
                        }
                      }

                      return (
                        // 사진 없는 배우는 opacity-50으로 흐릿하게 표시, hover 시 복원
                        <div key={actor.id}
                             className={`bg-white rounded-2xl border border-stone-100 shadow-sm p-4
                                         flex items-start gap-4 transition-opacity
                                         ${!hasImage ? 'opacity-50 hover:opacity-90' : ''}`}>
                          {/* 사진 미리보기 — 클릭하면 URL 입력칸으로 포커스 이동 */}
                          <div
                            className="w-16 h-16 rounded-xl overflow-hidden bg-stone-100 shrink-0
                                       flex items-center justify-center cursor-pointer"
                            onClick={() => document.getElementById(`actor-url-${actor.id}`)?.focus()}
                            title="클릭하면 URL 입력칸으로 이동"
                          >
                            {currentUrl ? (
                              <img src={currentUrl} alt={actor.name}
                                   className="w-full h-full object-cover"
                                   onError={e => { e.target.style.display = 'none' }} />
                            ) : (
                              <span className="text-2xl text-stone-400">{actor.name?.[0] ?? '?'}</span>
                            )}
                          </div>

                          {/* 배우 정보 + 편집 */}
                          <div className="flex-1 min-w-0 space-y-2">
                            <p className="font-semibold text-stone-800 text-sm">{actor.name}</p>

                            {/* URL 직접 입력 */}
                            <div className="flex gap-2">
                              <input
                                id={`actor-url-${actor.id}`}
                                type="url"
                                value={currentUrl}
                                onChange={e => setActorEdits(prev => ({
                                  ...prev,
                                  [actor.id]: { ...prev[actor.id], imageUrl: e.target.value },
                                }))}
                                placeholder="이미지 URL 입력..."
                                className={`${INPUT} flex-1 text-xs`}
                              />
                            </div>

                            {/* 버튼 행: 위키백과 자동 검색 / 저장 */}
                            <div className="flex gap-2 flex-wrap">
                              <button
                                onClick={handleWikiSearch}
                                disabled={wikiing}
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg
                                           bg-blue-50 text-blue-700 hover:bg-blue-100
                                           disabled:opacity-50 transition-colors"
                              >
                                {wikiing ? '검색 중...' : '🔍 위키백과 자동'}
                              </button>
                              <button
                                onClick={handleSaveImage}
                                disabled={saving || !currentUrl.trim()}
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg
                                           bg-emerald-600 text-white hover:bg-emerald-500
                                           disabled:opacity-50 transition-colors"
                              >
                                {saving ? '저장 중...' : saved ? '✅ 저장됨' : '저장'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  )
}
