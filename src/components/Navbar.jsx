// ─────────────────────────────────────────────
// Navbar.jsx — 상단 네비게이션
// ─────────────────────────────────────────────

import { Link, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import LoginModal from './LoginModal'
import NicknameModal from './NicknameModal'
import { NICKNAME_KEY } from './NicknameModal'

export default function Navbar() {
  const location  = useLocation()
  const [open,           setOpen]           = useState(false)  // 모바일 메뉴
  const [showLogin,      setShowLogin]      = useState(false)
  const [showNickname,   setShowNickname]   = useState(false)
  const { user, signOut } = useAuth()

  // 로그인 후 닉네임 없으면 닉네임 모달 자동 팝업
  useEffect(() => {
    if (user && !localStorage.getItem(NICKNAME_KEY)) {
      setShowNickname(true)
    }
  }, [user])

  const links = [
    { to: '/',      label: '공연 목록' },
    { to: '/admin', label: '관리자' },
  ]

  function openLogin() {
    setOpen(false)
    setShowLogin(true)
  }

  return (
    <>
      <header className="sticky top-0 z-50 bg-[#FAF8F5] text-[#2C1810] shadow-lg border-b border-[#E8E4DF]">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* 로고 */}
          <Link
            to="/"
            className="font-display text-lg tracking-wide hover:text-[#7A9E7F] transition-colors"
          >
            플레이픽
            <span className="ml-2 text-xs font-body text-stone-400 truncate max-w-[160px] sm:max-w-none inline">
              공연을 기록하고, 함께 기억하는 곳
            </span>
          </Link>

          {/* 데스크톱 메뉴 */}
          <nav className="hidden sm:flex items-center gap-6 text-sm">
            {links.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`hover:text-[#7A9E7F] transition-colors ${
                  location.pathname === to
                    ? 'text-[#7A9E7F] font-medium'
                    : 'text-[#6B5E52]'
                }`}
              >
                {label}
              </Link>
            ))}

            {/* 로그인/로그아웃 */}
            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-stone-400 max-w-[140px] truncate">
                  {localStorage.getItem(NICKNAME_KEY) || user.displayName || user.email}
                </span>
                <button
                  onClick={signOut}
                  className="text-xs px-3 py-1 rounded border border-[#7A9E7F]
                             text-[#6B5E52] hover:text-[#7A9E7F] hover:border-[#7A9E7F]
                             transition-colors"
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <button
                onClick={openLogin}
                className="text-xs px-3 py-1 rounded bg-[#8FAF94] text-white
                           font-medium hover:bg-[#7A9E7F] transition-colors"
              >
                로그인
              </button>
            )}
          </nav>

          {/* 모바일 햄버거 */}
          <button
            className="sm:hidden p-2 text-stone-300 hover:text-amber-400"
            onClick={() => setOpen(!open)}
            aria-label="메뉴"
          >
            {open ? '✕' : '☰'}
          </button>
        </div>

        {/* 모바일 드롭다운 */}
        {open && (
          <div className="sm:hidden bg-[#FAF8F5] border-t border-[#E8E4DF] px-4 py-3 flex flex-col gap-3">
            {links.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={`text-sm py-1 ${
                  location.pathname === to
                    ? 'text-[#7A9E7F] font-medium'
                    : 'text-[#6B5E52]'
                }`}
              >
                {label}
              </Link>
            ))}

            {/* 모바일 로그인/로그아웃 */}
            {user ? (
              <>
                <span className="text-xs text-stone-400 truncate">
                  {localStorage.getItem(NICKNAME_KEY) || user.displayName || user.email}
                </span>
                <button
                  onClick={() => { signOut(); setOpen(false) }}
                  className="text-sm py-1 text-[#6B5E52] hover:text-[#7A9E7F] text-left"
                >
                  로그아웃
                </button>
              </>
            ) : (
              <button
                onClick={openLogin}
                className="text-sm py-1 text-[#7A9E7F] text-left"
              >
                로그인
              </button>
            )}
          </div>
        )}
      </header>

      {/* 모달 */}
      {showLogin    && <LoginModal    onClose={() => setShowLogin(false)} />}
      {showNickname && <NicknameModal onClose={() => setShowNickname(false)} />}
    </>
  )
}
