// ─────────────────────────────────────────────
// LoginModal.jsx — 로그인 / 회원가입 모달
// ─────────────────────────────────────────────

import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

const FIREBASE_ERROR = {
  'auth/user-not-found':       '등록되지 않은 이메일입니다.',
  'auth/wrong-password':       '비밀번호가 올바르지 않습니다.',
  'auth/invalid-credential':   '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/email-already-in-use': '이미 사용 중인 이메일입니다.',
  'auth/weak-password':        '비밀번호는 6자 이상이어야 합니다.',
  'auth/invalid-email':        '올바른 이메일 형식이 아닙니다.',
  'auth/too-many-requests':    '잠시 후 다시 시도해주세요.',
}

function parseError(err) {
  return FIREBASE_ERROR[err?.code] ?? err?.message ?? '오류가 발생했습니다.'
}

export default function LoginModal({ onClose }) {
  const { signIn, signInWithEmail, signUpWithEmail } = useAuth()
  const [tab,      setTab]      = useState('login')  // 'login' | 'signup'
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [toast,    setToast]    = useState(false)

  function switchTab(t) {
    setTab(t)
    setError('')
    setConfirm('')
  }

  async function handleGoogle() {
    setError('')
    setLoading(true)
    try {
      await signIn()
      onClose()
    } catch (err) {
      setError(parseError(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (tab === 'signup' && password !== confirm) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }

    setLoading(true)
    try {
      if (tab === 'login') {
        await signInWithEmail(email, password)
        onClose()
      } else {
        await signUpWithEmail(email, password)
        setToast(true)
        setTimeout(onClose, 1500)
      }
    } catch (err) {
      setError(parseError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 relative">

        {/* 헤더 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex gap-1 bg-stone-100 rounded-xl p-1">
            {[{ key: 'login', label: '로그인' }, { key: 'signup', label: '회원가입' }].map(t => (
              <button
                key={t.key}
                onClick={() => switchTab(t.key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                  tab === t.key ? 'bg-white text-[#2C1810] shadow-sm' : 'text-stone-400 hover:text-stone-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* 이메일/비밀번호 폼 */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="이메일"
            required
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                       focus:outline-none focus:border-[#8FAF94] focus:ring-1 focus:ring-[#8FAF94]"
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="비밀번호 (6자 이상)"
            required
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                       focus:outline-none focus:border-[#8FAF94] focus:ring-1 focus:ring-[#8FAF94]"
          />
          {tab === 'signup' && (
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="비밀번호 확인"
              required
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                         focus:outline-none focus:border-[#8FAF94] focus:ring-1 focus:ring-[#8FAF94]"
            />
          )}

          {/* 에러 메시지 */}
          {error && (
            <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#8FAF94] hover:bg-[#7A9E7F] text-white text-sm
                       font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {loading ? '처리 중...' : tab === 'login' ? '로그인' : '회원가입'}
          </button>
        </form>

        {/* 구분선 */}
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-stone-100" />
          <span className="text-xs text-stone-400">또는</span>
          <div className="flex-1 h-px bg-stone-100" />
        </div>

        {/* 구글 로그인 */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 border border-stone-200
                     rounded-xl py-2.5 text-sm font-medium text-stone-700
                     hover:bg-stone-50 transition-colors disabled:opacity-50"
        >
          <img
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            alt="Google"
            className="w-4 h-4"
          />
          Google로 {tab === 'login' ? '로그인' : '가입'}
        </button>

        {/* 회원가입 완료 토스트 */}
        {toast && (
          <div className="absolute inset-x-0 bottom-0 rounded-b-2xl bg-[#2C1810] text-white
                          text-sm font-medium text-center py-3">
            환영해요! 🎭
          </div>
        )}
      </div>
    </div>
  )
}
