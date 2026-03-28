// ─────────────────────────────────────────────
// AdminPage.jsx — 관리자 페이지
// ─────────────────────────────────────────────
// 탭 구성:
//   - 대기 중    : pending 컬렉션, 리스트 행 + 사이드 패널 수정
//   - 공연 추가  : 폼 입력 → pending 저장
//   - 등록 완료  : shows 컬렉션, 카드 수정/삭제
// ─────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import { db, isFirebaseConfigured } from '../firebase'
import {
  doc, setDoc, deleteDoc, collection,
  onSnapshot, writeBatch, serverTimestamp,
  query, orderBy, getDocs, updateDoc,
} from 'firebase/firestore'

const ADMIN_PW = import.meta.env.VITE_ADMIN_PASSWORD ?? 'theater2025'

// 대기 중 탭 한 페이지에 표시할 행 수
const PENDING_PAGE_SIZE = 50

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

  // ── actors 컬렉션에 없는 경우 이름으로 새 배우 직접 추가 ──
  function addNewActor() {
    const name = actorQuery.trim()
    if (!name) return
    onChange([...cast, { actorId: '', actorName: name, roleName: '', isDouble: false, imageUrl: null }])
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
                  <p className="text-sm font-semibold text-stone-800">{actor.name}</p>
                  {actor.bio && (
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
  // tags 배열 → 쉼표 문자열로 편집
  const [tagsStr, setTagsStr] = useState(
    Array.isArray(draft.tags) ? draft.tags.join(', ') : (draft.tags ?? '')
  )

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
        <label className={LABEL}>시놉시스</label>
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
                src={posterUrl}
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


// ── 등록 완료 공연 카드 ───────────────────────
function ShowCard({ show, onUpdate, onDelete, onRevert }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState({ ...show })

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

  // ── 편집 모드 ──
  if (editing) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border-2 border-amber-300 p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-display text-lg font-bold text-stone-900">{show.title}</h3>
            <p className="text-xs text-stone-400 mt-0.5">공연 정보 수정 중</p>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${genreColor}`}>
            {show.genre || '장르 미정'}
          </span>
        </div>
        <ShowEditForm
          draft={draft}
          onChangeDraft={handleChangeDraft}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </div>
    )
  }

  // ── 보기 모드 ──
  return (
    <div className="bg-white rounded-2xl shadow-sm border-2 border-stone-100 hover:border-stone-200 transition-colors">
      <div className="p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${genreColor}`}>
            {show.genre || '장르 미정'}
          </span>
          <span className="text-xs font-semibold text-emerald-700 bg-emerald-50
                           border border-emerald-200 px-2.5 py-1 rounded-full shrink-0">
            공개 중
          </span>
        </div>

        <h3 className="font-display text-xl font-bold text-stone-900 leading-tight">
          {show.title}
        </h3>
        {show.subtitle && (
          <p className="text-sm text-stone-400 mt-0.5">{show.subtitle}</p>
        )}

        <div className="mt-3 space-y-1.5 text-sm text-stone-600">
          {show.venue && (
            <div className="flex items-start gap-2">
              <span className="shrink-0">📍</span>
              <span>{show.venue}</span>
            </div>
          )}
          {(show.startDate || show.endDate) && (
            <div className="flex items-start gap-2">
              <span className="shrink-0">📅</span>
              <span>{show.startDate || '?'} ~ {show.endDate || '?'}</span>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-stone-100 grid grid-cols-3 divide-x divide-stone-100">
        <button
          onClick={() => setEditing(true)}
          className="flex items-center justify-center gap-1.5 py-3.5 text-sm font-semibold
                     text-stone-600 hover:bg-stone-50 rounded-bl-2xl transition-colors"
        >
          <span>✏️</span>
          <span>수정</span>
        </button>
        <button
          onClick={() => onRevert(show.id)}
          className="flex items-center justify-center gap-1.5 py-3.5 text-sm font-semibold
                     text-amber-600 hover:bg-amber-50 transition-colors"
        >
          <span>↩️</span>
          <span>반려</span>
        </button>
        <button
          onClick={() => onDelete(show.id)}
          className="flex items-center justify-center gap-1.5 py-3.5 text-sm font-semibold
                     text-red-600 hover:bg-red-50 rounded-br-2xl transition-colors"
        >
          <span>🗑️</span>
          <span>삭제</span>
        </button>
      </div>
    </div>
  )
}


// ── 출연진 입력 섹션 ──────────────────────────
// cast: [{ actorId, actorName, actorImage, role }]
// onChange: (newCast) => void
function ActorCastSection({ cast, onChange }) {
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

      {/* 이미 추가된 배우 태그 목록 */}
      {cast.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {cast.map(c => (
            <div key={c.actorId}
                 className="flex items-center gap-1.5 bg-amber-50 border border-amber-200
                            rounded-full pl-1 pr-2 py-1 text-xs">
              {/* 썸네일 */}
              {c.actorImage ? (
                <img src={c.actorImage} alt={c.actorName}
                     className="w-6 h-6 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-amber-200 shrink-0
                                flex items-center justify-center font-bold text-amber-700">
                  {c.actorName?.[0]}
                </div>
              )}
              <span className="font-medium text-stone-800">{c.actorName}</span>
              {c.role && <span className="text-stone-400">({c.role})</span>}
              {/* X 삭제 버튼 */}
              <button
                type="button"
                onClick={() => removeCast(c.actorId)}
                className="ml-0.5 text-stone-400 hover:text-red-500 transition-colors
                           font-bold leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
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
                  <p className="text-sm font-semibold text-stone-800">{actor.name}</p>
                  {/* 주요 출연작 대신 bio 요약 표시 */}
                  {actor.bio && (
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


// ── 메인 컴포넌트 ─────────────────────────────
export default function AdminPage() {
  const [authed,      setAuthed]      = useState(false)
  const [password,    setPassword]    = useState('')
  const [tab,         setTab]         = useState('pending')
  const [pendingList, setPendingList] = useState([])
  const [showsList,   setShowsList]   = useState([])
  const [selected,    setSelected]    = useState(new Set())
  const [dataLoading, setDataLoading] = useState(false)

  // ── 대기 중 탭 필터 상태 ──────────────────────
  // 기간 필터: all / short(7일↓) / medium(8~30일) / long(31일↑)
  const [filterDuration, setFilterDuration] = useState('all')
  // 지역 필터: all / daehakro / seoul_center / seoul_outer / province
  const [filterRegion,   setFilterRegion]   = useState('all')
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
  useEffect(() => { setPendingPage(0) }, [filterDuration, filterRegion, sortBy])

  // 현재 페이지에 보여줄 행 (50건 슬라이싱)
  const totalPendingPages   = Math.max(1, Math.ceil(filteredPendingList.length / PENDING_PAGE_SIZE))
  const paginatedPendingList = filteredPendingList.slice(
    pendingPage * PENDING_PAGE_SIZE,
    (pendingPage + 1) * PENDING_PAGE_SIZE,
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

  // ── shows → pending 반려 ─────────────────────
  async function handleRevertShow(id) {
    if (!window.confirm('이 공연을 대기열로 되돌릴까요?')) return
    const show = showsList.find(s => s.id === id)
    if (!show) return
    try {
      const { approvedAt, ...showData } = show
      const batch = writeBatch(db)
      batch.set(doc(db, 'pending', id), {
        ...showData,
        id,
        status:      'pending',
        collectedAt: serverTimestamp(),
      })
      batch.delete(doc(db, 'shows', id))
      await batch.commit()
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
            { key: 'pending', icon: '⏳', label: '대기 중',  count: pendingList.length },
            { key: 'add',     icon: '➕', label: '공연 추가', count: null },
            { key: 'shows',   icon: '✅', label: '등록 완료', count: showsList.length },
            { key: 'actors',  icon: '👤', label: '배우 관리', count: null },
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
                {(filterDuration !== 'all' || filterRegion !== 'all') && (
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
                  onClick={() => { setFilterDuration('all'); setFilterRegion('all') }}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {showsList.map(show => (
                  <ShowCard
                    key={show.id}
                    show={show}
                    onUpdate={handleUpdateShow}
                    onDelete={handleDeleteShow}
                    onRevert={handleRevertShow}
                  />
                ))}
              </div>
            )}
          </div>
        )}


        {/* ════════ 배우 관리 탭 ════════ */}
        {tab === 'actors' && (
          <div className="space-y-4">
            {/* 안내 */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <strong>배우 관리</strong> — actors 컬렉션에 등록된 배우의 사진을 수정합니다.
              위키백과 자동 검색 또는 직접 URL 입력 후 저장하세요.
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
                  const edit = actorEdits[actor.id] ?? {}
                  const currentUrl = edit.imageUrl !== undefined ? edit.imageUrl : (actor.imageUrl ?? '')
                  const saving  = edit._saving  ?? false
                  const wikiing = edit._wikiing ?? false
                  const saved   = edit._saved   ?? false

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
                    <div key={actor.id}
                         className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4
                                    flex items-start gap-4">
                      {/* 사진 미리보기 */}
                      <div className="w-16 h-16 rounded-xl overflow-hidden bg-stone-100 shrink-0 flex items-center justify-center">
                        {currentUrl ? (
                          <img src={currentUrl} alt={actor.name}
                               className="w-full h-full object-cover"
                               onError={e => { e.target.style.display = 'none' }} />
                        ) : (
                          <span className="text-2xl text-stone-400">{actor.name?.[0] ?? '?'}</span>
                        )}
                      </div>

                      {/* 정보 + 편집 */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <p className="font-semibold text-stone-800 text-sm">{actor.name}</p>

                        {/* URL 입력 */}
                        <div className="flex gap-2">
                          <input
                            type="url"
                            value={currentUrl}
                            onChange={e => setActorEdits(prev => ({ ...prev, [actor.id]: { ...prev[actor.id], imageUrl: e.target.value } }))}
                            placeholder="이미지 URL 입력..."
                            className={`${INPUT} flex-1 text-xs`}
                          />
                        </div>

                        {/* 버튼 행 */}
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
    </div>
  )
}
