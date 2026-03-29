// ─────────────────────────────────────────────
// Layout.jsx — 공통 레이아웃 (Navbar + 콘텐츠 + Footer)
// ─────────────────────────────────────────────

import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F5]">
      <Navbar />

      {/* 페이지 콘텐츠 */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        <Outlet />
      </main>

      {/* 푸터 */}
      <footer className="bg-[#3D3530] text-[#C4B5A8] text-xs py-6 px-4 text-center">
        <p className="font-display text-[#E8DDD5] mb-1">플레이픽</p>
        <p>연극·뮤지컬 공연 아카이브</p>
        <p className="mt-2 text-stone-600">
          MVP v0.1 — 데이터는 수동 입력 기반입니다
        </p>
      </footer>
    </div>
  )
}
