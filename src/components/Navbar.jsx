// ─────────────────────────────────────────────
// Navbar.jsx — 상단 네비게이션
// ─────────────────────────────────────────────

import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

export default function Navbar() {
  const location  = useLocation()
  const [open, setOpen] = useState(false)  // 모바일 메뉴
  const { user, signIn, signOut } = useAuth()

  const links = [
    { to: '/',      label: '공연 목록' },
    { to: '/admin', label: '관리자' },
  ]

  return (
    <header className="sticky top-0 z-50 bg-stone-900 text-stone-100 shadow-lg">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* 로고 */}
        <Link
          to="/"
          className="font-display text-lg tracking-wide hover:text-amber-400 transition-colors"
        >
          막이 오르면
          <span className="ml-2 text-xs font-body text-stone-400 hidden sm:inline">
            서울 공연 아카이브
          </span>
        </Link>

        {/* 데스크톱 메뉴 */}
        <nav className="hidden sm:flex items-center gap-6 text-sm">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`hover:text-amber-400 transition-colors ${
                location.pathname === to
                  ? 'text-amber-400 font-medium'
                  : 'text-stone-300'
              }`}
            >
              {label}
            </Link>
          ))}

          {/* 로그인/로그아웃 */}
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-stone-400 max-w-[140px] truncate">
                {user.displayName || user.email}
              </span>
              <button
                onClick={signOut}
                className="text-xs px-3 py-1 rounded border border-stone-600
                           text-stone-300 hover:text-amber-400 hover:border-amber-400
                           transition-colors"
              >
                로그아웃
              </button>
            </div>
          ) : (
            <button
              onClick={signIn}
              className="text-xs px-3 py-1 rounded bg-amber-500 text-stone-900
                         font-medium hover:bg-amber-400 transition-colors"
            >
              구글로 로그인
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
        <div className="sm:hidden bg-stone-800 border-t border-stone-700 px-4 py-3 flex flex-col gap-3">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={`text-sm py-1 ${
                location.pathname === to
                  ? 'text-amber-400 font-medium'
                  : 'text-stone-300'
              }`}
            >
              {label}
            </Link>
          ))}

          {/* 모바일 로그인/로그아웃 */}
          {user ? (
            <>
              <span className="text-xs text-stone-400 truncate">
                {user.displayName || user.email}
              </span>
              <button
                onClick={() => { signOut(); setOpen(false) }}
                className="text-sm py-1 text-stone-300 hover:text-amber-400 text-left"
              >
                로그아웃
              </button>
            </>
          ) : (
            <button
              onClick={() => { signIn(); setOpen(false) }}
              className="text-sm py-1 text-amber-400 text-left"
            >
              구글로 로그인
            </button>
          )}
        </div>
      )}
    </header>
  )
}
