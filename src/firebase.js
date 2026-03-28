// ─────────────────────────────────────────────
// firebase.js — Firebase 초기화 및 인스턴스 내보내기
// ─────────────────────────────────────────────
// 이 파일을 수정하지 마세요.
// 값은 .env 파일(VITE_FIREBASE_* 변수)에서 자동으로 불러옵니다.
// ─────────────────────────────────────────────

import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

// Firebase 환경변수가 설정됐는지 확인
export const isFirebaseConfigured =
  !!firebaseConfig.apiKey && firebaseConfig.apiKey !== 'your_api_key_here'

let app, db, auth

if (isFirebaseConfigured) {
  app  = initializeApp(firebaseConfig)
  db   = getFirestore(app)
  auth = getAuth(app)
} else {
  // .env 설정 전에도 더미 데이터로 UI가 뜨도록 null로 둠
  console.warn('[Firebase] .env 설정이 없습니다. 더미 데이터로 실행합니다.')
  db   = null
  auth = null
}

export { db, auth }
export default app
