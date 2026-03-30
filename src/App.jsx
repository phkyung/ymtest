// ─────────────────────────────────────────────
// App.jsx — 라우팅 설정
// ─────────────────────────────────────────────
// 페이지를 추가하려면:
//   1. src/pages/에 새 파일을 만들고
//   2. 아래 import 추가
//   3. <Route> 추가
// ─────────────────────────────────────────────

import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout    from './components/Layout'
import HomePage  from './pages/HomePage'
import ShowPage  from './pages/ShowPage'
import ActorPage from './pages/ActorPage'
import AdminPage      from './pages/AdminPage'
import CastingBoard   from './pages/CastingBoard'
import ActorArchive   from './pages/ActorArchive'
import NotFoundPage   from './pages/NotFoundPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* 홈 — 공연 목록 */}
          <Route path="/"              element={<HomePage />} />

          {/* 공연 상세 */}
          <Route path="/shows/:showId" element={<ShowPage />} />

          {/* 배우 상세 */}
          <Route path="/actors/:actorId" element={<ActorPage />} />

          {/* 캐스팅 보드 */}
          <Route path="/casting"       element={<CastingBoard />} />

          {/* 배우 아카이브 */}
          <Route path="/actors"        element={<ActorArchive />} />

          {/* 관리자 (JSON 업로드) */}
          <Route path="/admin"         element={<AdminPage />} />

          {/* 404 */}
          <Route path="*"              element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
