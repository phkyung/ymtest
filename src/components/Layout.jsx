// ─────────────────────────────────────────────
// Layout.jsx — 공통 레이아웃 (Navbar + 콘텐츠 + Footer)
// ─────────────────────────────────────────────

import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-stone-50">
      <Navbar />

      {/* 페이지 콘텐츠 */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        <Outlet />
      </main>

      {/* 푸터 */}
      <footer className="bg-stone-900 text-stone-400 text-xs py-6 px-4 text-center">
        <p className="font-display text-stone-300 mb-1">막이 오르면</p>
        <p>서울 연극·뮤지컬 아카이브 | 대학로 중심 공연 정보</p>
        <p className="mt-2 text-stone-600">
          MVP v0.1 — 데이터는 수동 입력 기반입니다
        </p>
      </footer>
    </div>
  )
}
