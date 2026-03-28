// ─────────────────────────────────────────────
// AdminPage.jsx — 관리자 페이지 (카드 UI)
// ─────────────────────────────────────────────
// 탭 구성:
//   - 대기 중    : pending 컬렉션, 카드 승인/수정/거절
//   - 공연 추가  : 폼 입력 → pending 저장
//   - 등록 완료  : shows 컬렉션, 카드 수정/삭제
// ─────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { db, isFirebaseConfigured } from '../firebase'
import {
  doc, setDoc, deleteDoc, collection,
  onSnapshot, writeBatch, serverTimestamp,
  query, orderBy,
} from 'firebase/firestore'

const ADMIN_PW = import.meta.env.VITE_ADMIN_PASSWORD ?? 'theater2025'

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


// ── 공연 정보 편집 폼 (대기 중 · 등록 완료 공통) ──
function ShowEditForm({ draft, onChangeDraft, onSave, onCancel }) {
  // tags 배열 → 쉼표 문자열로 편집
  const [tagsStr, setTagsStr] = useState(
    Array.isArray(draft.tags) ? draft.tags.join(', ') : (draft.tags ?? '')
  )

  function handleSave() {
    const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean)
    onSave({ ...draft, tags })
  }

  return (
    <div className="space-y-4">
      {/* 기본 정보 */}
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
          <label className={LABEL}>티켓 URL</label>
          <input
            value={draft.ticketUrl ?? ''}
            onChange={e => onChangeDraft('ticketUrl', e.target.value)}
            placeholder="https://..."
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

      {/* 시놉시스 */}
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

      {/* 태그 */}
      <div>
        <label className={LABEL}>태그 (쉼표로 구분)</label>
        <input
          value={tagsStr}
          onChange={e => setTagsStr(e.target.value)}
          placeholder="대형뮤지컬, 명작, 가족"
          className={INPUT}
        />
      </div>

      {/* 버튼 */}
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


// ── 대기 중 공연 카드 ─────────────────────────
function PendingCard({ show, selected, onSelect, onApprove, onReject, onUpdate }) {
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
    <div className={`bg-white rounded-2xl shadow-sm border-2 transition-all
                     ${selected
                       ? 'border-amber-400 shadow-amber-100 shadow-md'
                       : 'border-stone-100 hover:border-stone-200'}`}>
      {/* 카드 본문 */}
      <div className="p-5">
        {/* 상단: 체크박스 + 장르 뱃지 */}
        <div className="flex items-center justify-between mb-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selected}
              onChange={onSelect}
              className="w-4 h-4 accent-amber-500"
            />
            <span className="text-xs text-stone-400">선택</span>
          </label>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${genreColor}`}>
            {show.genre || '장르 미정'}
          </span>
        </div>

        {/* 제목 */}
        <h3 className="font-display text-xl font-bold text-stone-900 leading-tight">
          {show.title}
        </h3>
        {show.subtitle && (
          <p className="text-sm text-stone-400 mt-0.5">{show.subtitle}</p>
        )}

        {/* 공연 정보 */}
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
              <span>
                {show.startDate || '?'} ~ {show.endDate || '?'}
              </span>
            </div>
          )}
          {show.runtime && (
            <div className="flex items-start gap-2">
              <span className="shrink-0">🕐</span>
              <span>총 {show.runtime}분</span>
            </div>
          )}
          {show.source && (
            <div className="flex items-start gap-2">
              <span className="shrink-0">🔖</span>
              <span className="text-stone-400">출처: {show.source}</span>
            </div>
          )}
        </div>
      </div>

      {/* 카드 하단 버튼 3개 */}
      <div className="border-t border-stone-100 grid grid-cols-3 divide-x divide-stone-100">
        <button
          onClick={() => onApprove(show.id)}
          className="flex items-center justify-center gap-1.5 py-3.5 text-sm font-semibold
                     text-emerald-700 hover:bg-emerald-50 rounded-bl-2xl transition-colors"
        >
          <span>✅</span>
          <span>승인</span>
        </button>
        <button
          onClick={() => setEditing(true)}
          className="flex items-center justify-center gap-1.5 py-3.5 text-sm font-semibold
                     text-stone-600 hover:bg-stone-50 transition-colors"
        >
          <span>✏️</span>
          <span>수정</span>
        </button>
        <button
          onClick={() => onReject(show.id)}
          className="flex items-center justify-center gap-1.5 py-3.5 text-sm font-semibold
                     text-red-600 hover:bg-red-50 rounded-br-2xl transition-colors"
        >
          <span>❌</span>
          <span>거절</span>
        </button>
      </div>
    </div>
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


// ── 메인 컴포넌트 ─────────────────────────────
export default function AdminPage() {
  const [authed,      setAuthed]      = useState(false)
  const [password,    setPassword]    = useState('')
  const [tab,         setTab]         = useState('pending')
  const [pendingList, setPendingList] = useState([])
  const [showsList,   setShowsList]   = useState([])
  const [selected,    setSelected]    = useState(new Set())
  const [dataLoading, setDataLoading] = useState(false)

  // 공연 추가 폼 상태
  const [addForm,   setAddForm]   = useState({ ...EMPTY_FORM })
  const [addStatus, setAddStatus] = useState(null)   // { type, msg }
  const [addLoading, setAddLoading] = useState(false)

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

  // ── 체크박스 ─────────────────────────────────
  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected(
      selected.size === pendingList.length
        ? new Set()
        : new Set(pendingList.map(s => s.id))
    )
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
    try {
      await deleteDoc(doc(db, 'pending', id))
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
    } catch (err) {
      console.error('거절 오류:', err)
      alert('거절 중 오류가 발생했습니다.')
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
    try {
      const batch = writeBatch(db)
      for (const id of selected) batch.delete(doc(db, 'pending', id))
      await batch.commit()
      setSelected(new Set())
    } catch (err) {
      console.error('일괄 거절 오류:', err)
      alert('일괄 거절 중 오류가 발생했습니다.')
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
        status:      'pending',
        collectedAt: serverTimestamp(),
      })
      setAddStatus({ type: 'success', msg: `「${addForm.title}」이(가) 대기열에 추가됐습니다. 대기 중 탭에서 승인해주세요.` })
      setAddForm({ ...EMPTY_FORM })
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
    if (!window.confirm('등록된 공연을 삭제하면 사이트에서 즉시 내려갑니다. 계속할까요?')) return
    try {
      await deleteDoc(doc(db, 'shows', id))
    } catch (err) {
      console.error('shows 삭제 오류:', err)
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
      <div className="max-w-3xl mx-auto space-y-6">

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
            { key: 'pending', icon: '⏳', label: '대기 중', count: pendingList.length },
            { key: 'add',     icon: '➕', label: '공연 추가',  count: null },
            { key: 'shows',   icon: '✅', label: '등록 완료', count: showsList.length },
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

            {/* 일괄 액션 바 */}
            {pendingList.length > 0 && (
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-4 py-3
                              flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selected.size === pendingList.length && pendingList.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 accent-amber-500"
                  />
                  <span className="font-medium">전체 선택</span>
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

            {/* 카드 목록 */}
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
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {pendingList.map(show => (
                  <PendingCard
                    key={show.id}
                    show={show}
                    selected={selected.has(show.id)}
                    onSelect={() => toggleSelect(show.id)}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onUpdate={handleUpdatePending}
                  />
                ))}
              </div>
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
                  onClick={() => setAddForm({ ...EMPTY_FORM })}
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

      </div>
    </div>
  )
}
