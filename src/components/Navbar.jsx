// ─────────────────────────────────────────────
// Navbar.jsx — 상단 네비게이션
// ─────────────────────────────────────────────

import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'

export default function Navbar() {
  const location  = useLocation()
  const [open, setOpen] = useState(false)  // 모바일 메뉴

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
        </div>
      )}
    </header>
  )
}
