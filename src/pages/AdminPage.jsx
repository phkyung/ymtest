// ─────────────────────────────────────────────
// AdminPage.jsx — 관리자 페이지 (MVP 버전)
// ─────────────────────────────────────────────
// 기능:
//   1. JSON 붙여넣기로 공연 데이터 Firestore에 업로드
//   2. 샘플 JSON 구조 보기
//   3. 간단한 비밀번호 보호 (VITE_ADMIN_PASSWORD)
//
// ⚠️ 나중에 Firebase Auth + Admin 역할로 교체할 것
// ─────────────────────────────────────────────

import { useState } from 'react'
import { db, isFirebaseConfigured } from '../firebase'
import { doc, setDoc, collection } from 'firebase/firestore'
import sampleShows from '../data/sampleShows.json'

const ADMIN_PW = import.meta.env.VITE_ADMIN_PASSWORD ?? 'theater2025'

// JSON 포맷 미리보기 (배열의 첫 번째 항목만)
const SAMPLE_SNIPPET = JSON.stringify([sampleShows[0]], null, 2)

export default function AdminPage() {
  const [authed, setAuthed]     = useState(false)
  const [password, setPassword] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [status, setStatus]     = useState(null)  // { type: 'success'|'error', msg }
  const [loading, setLoading]   = useState(false)

  // ── 비밀번호 확인 ──────────────────────────────
  function handleLogin(e) {
    e.preventDefault()
    if (password === ADMIN_PW) {
      setAuthed(true)
    } else {
      alert('비밀번호가 틀렸습니다.')
    }
  }

  // ── JSON → Firestore 업로드 ────────────────────
  async function handleUpload() {
    setStatus(null)
    let parsed

    // JSON 파싱
    try {
      parsed = JSON.parse(jsonText)
      if (!Array.isArray(parsed)) parsed = [parsed]
    } catch {
      setStatus({ type: 'error', msg: 'JSON 형식이 올바르지 않습니다. 콘솔에서 오류를 확인하세요.' })
      return
    }

    if (!isFirebaseConfigured || !db) {
      setStatus({ type: 'error', msg: 'Firebase가 연결되지 않았습니다. .env 파일을 확인하세요.' })
      return
    }

    setLoading(true)
    let success = 0, fail = 0

    for (const show of parsed) {
      // id가 없으면 자동 생성
      const id = show.id ?? `show_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      try {
        await setDoc(doc(collection(db, 'shows'), id), { ...show, id })
        success++
      } catch (err) {
        console.error(`업로드 실패 (${show.title}):`, err)
        fail++
      }
    }

    setLoading(false)
    setStatus({
      type: fail === 0 ? 'success' : 'error',
      msg: `완료: ${success}개 업로드 성공${fail > 0 ? `, ${fail}개 실패` : ''}`,
    })

    if (fail === 0) setJsonText('')
  }

  // ── 비밀번호 로그인 화면 ──────────────────────
  if (!authed) {
    return (
      <div className="max-w-sm mx-auto mt-16">
        <h1 className="font-display text-2xl text-stone-800 mb-6 text-center">
          관리자 로그인
        </h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="비밀번호 입력"
            className="w-full border border-stone-200 rounded-lg px-4 py-2.5 text-sm
                       focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
          <button
            type="submit"
            className="w-full bg-stone-800 text-white py-2.5 rounded-lg text-sm
                       hover:bg-amber-700 transition-colors"
          >
            입장
          </button>
        </form>
        <p className="text-center text-xs text-stone-400 mt-4">
          기본 비밀번호: theater2025 (.env에서 변경 가능)
        </p>
      </div>
    )
  }

  // ── 관리자 메인 화면 ──────────────────────────
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-stone-800">관리자 패널</h1>
        <span className="text-xs text-stone-400 bg-stone-100 px-2 py-1 rounded">MVP v0.1</span>
      </div>

      {/* Firebase 상태 */}
      <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
        isFirebaseConfigured
          ? 'bg-green-50 border border-green-200 text-green-800'
          : 'bg-amber-50 border border-amber-200 text-amber-800'
      }`}>
        <span>{isFirebaseConfigured ? '✅' : '⚠️'}</span>
        <span>
          Firebase: {isFirebaseConfigured ? '연결됨' : '미연결 (로컬 더미 모드)'}
        </span>
      </div>

      {/* ── 공연 JSON 업로드 ── */}
      <section className="bg-white border border-stone-100 rounded-xl p-5 space-y-4">
        <h2 className="font-display text-lg text-stone-800">공연 데이터 업로드</h2>
        <p className="text-sm text-stone-500">
          아래 JSON 형식에 맞게 공연 데이터를 붙여넣고 업로드하면 Firestore에 저장됩니다.
        </p>

        {/* 샘플 보기 */}
        <details className="text-xs">
          <summary className="cursor-pointer text-amber-600 hover:text-amber-700 mb-2">
            JSON 형식 보기 (샘플)
          </summary>
          <pre className="bg-stone-50 border border-stone-100 rounded-lg p-3 overflow-x-auto text-stone-600 leading-relaxed">
            {SAMPLE_SNIPPET}
          </pre>
        </details>

        <textarea
          value={jsonText}
          onChange={e => setJsonText(e.target.value)}
          rows={12}
          placeholder='[ { "id": "show_xxx", "title": "공연명", ... } ]'
          className="w-full font-mono text-xs border border-stone-200 rounded-lg p-3
                     focus:outline-none focus:ring-2 focus:ring-amber-300 resize-y"
        />

        <div className="flex items-center gap-3">
          <button
            onClick={handleUpload}
            disabled={!jsonText.trim() || loading}
            className="px-5 py-2.5 bg-stone-800 text-white text-sm rounded-lg
                       hover:bg-amber-700 transition-colors disabled:opacity-40"
          >
            {loading ? '업로드 중...' : 'Firestore에 업로드'}
          </button>

          {/* 샘플 자동 로드 버튼 */}
          <button
            onClick={() => setJsonText(JSON.stringify(sampleShows, null, 2))}
            className="px-4 py-2.5 border border-stone-200 text-stone-600 text-sm rounded-lg
                       hover:border-stone-400 transition-colors"
          >
            샘플 5개 불러오기
          </button>
        </div>

        {/* 업로드 결과 */}
        {status && (
          <div className={`p-3 rounded-lg text-sm ${
            status.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}>
            {status.msg}
          </div>
        )}
      </section>

      {/* 다음 단계 힌트 */}
      <section className="bg-stone-50 border border-stone-200 rounded-xl p-5">
        <h3 className="font-medium text-stone-700 mb-3 text-sm">다음에 추가할 것들 (2차)</h3>
        <ul className="text-sm text-stone-500 space-y-1 list-disc list-inside">
          <li>배우 데이터 직접 등록</li>
          <li>공연 개별 수정/삭제</li>
          <li>Firebase Auth 이메일 로그인으로 관리자 권한 분리</li>
          <li>공연 이미지 Firebase Storage 업로드</li>
          <li>공연 정보 크롤링/자동 수집 (3차)</li>
        </ul>
      </section>
    </div>
  )
}
