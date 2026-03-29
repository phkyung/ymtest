import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <p className="text-7xl mb-6">🎭</p>
      <h1 className="font-display text-2xl sm:text-3xl text-[#2C1810] leading-tight mb-2">
        막이 내린 페이지예요
      </h1>
      <p className="text-stone-400 text-sm mb-8">
        찾으시는 공연이나 페이지가 없어요
      </p>
      <Link
        to="/"
        className="px-5 py-2.5 bg-[#8FAF94] hover:bg-[#7A9E7F] text-white
                   text-sm font-medium rounded-xl transition-colors"
      >
        홈으로 돌아가기
      </Link>
    </div>
  )
}
