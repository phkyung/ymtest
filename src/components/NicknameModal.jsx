// ─────────────────────────────────────────────
// NicknameModal.jsx — 닉네임 설정 모달
// 로그인 후 닉네임 없으면 자동 팝업
// 닉네임은 localStorage에 저장 (추후 Firestore 연동 예정)
// ─────────────────────────────────────────────

import { useState } from 'react'

export const NICKNAME_KEY = 'playpick_nickname'

export function getNickname() {
  return localStorage.getItem(NICKNAME_KEY) || '익명'
}

export default function NicknameModal({ onClose }) {
  const [value,   setValue]   = useState('')
  const [error,   setError]   = useState('')

  function handleSave() {
    const trimmed = value.trim()
    if (trimmed.length < 2) { setError('닉네임은 2자 이상이어야 합니다.'); return }
    if (trimmed.length > 10) { setError('닉네임은 10자 이하여야 합니다.'); return }
    localStorage.setItem(NICKNAME_KEY, trimmed)
    onClose()
  }

  function handleSkip() {
    // 스킵 시 '익명' 저장해서 다시 뜨지 않게
    localStorage.setItem(NICKNAME_KEY, '익명')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h2 className="font-display text-lg font-semibold text-[#2C1810] mb-1">
          닉네임을 설정해주세요
        </h2>
        <p className="text-sm text-stone-400 mb-5">
          댓글 작성 시 표시됩니다. (2~10자)
        </p>

        <input
          type="text"
          value={value}
          onChange={e => { setValue(e.target.value); setError('') }}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder="닉네임 입력"
          maxLength={10}
          className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                     focus:outline-none focus:border-[#8FAF94] focus:ring-1 focus:ring-[#8FAF94] mb-2"
        />

        {error && (
          <p className="text-xs text-red-500 mb-3">{error}</p>
        )}

        <div className="flex gap-2 mt-1">
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 bg-[#8FAF94] hover:bg-[#7A9E7F] text-white text-sm
                       font-semibold rounded-xl transition-colors"
          >
            저장
          </button>
          <button
            onClick={handleSkip}
            className="px-4 py-2.5 border border-stone-200 text-stone-400 text-sm
                       rounded-xl hover:bg-stone-50 transition-colors"
          >
            나중에
          </button>
        </div>
      </div>
    </div>
  )
}
