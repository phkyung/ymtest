// check-poster-url.mjs
// shows 컬렉션 처음 5개 문서의 posterUrl 필드 상태 확인
// 실행: node check-poster-url.mjs

import { readFileSync } from 'fs'
import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs, limit, query, where } from 'firebase/firestore'

// .env 파싱 (dotenv 없이)
const env = Object.fromEntries(
  readFileSync('.env', 'utf-8')
    .split('\n')
    .filter(line => line.includes('=') && !line.startsWith('#'))
    .map(line => {
      const idx = line.indexOf('=')
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()]
    })
)

const app = initializeApp({
  apiKey:            env.VITE_FIREBASE_API_KEY,
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             env.VITE_FIREBASE_APP_ID,
})

const db = getFirestore(app)

const snap = await getDocs(query(collection(db, 'shows'), where('status', '==', 'approved'), limit(5)))

console.log(`\n=== posterUrl 상태 확인 (총 ${snap.size}개) ===\n`)

snap.docs.forEach((doc, i) => {
  const data = doc.data()
  const url  = data.posterUrl

  let status
  if (!url) {
    status = '없음 (null/undefined/빈값)'
  } else if (url.startsWith('https://')) {
    status = `https:// ✓  →  ${url.slice(0, 80)}${url.length > 80 ? '...' : ''}`
  } else if (url.startsWith('http://')) {
    status = `http://  ⚠  →  ${url.slice(0, 80)}${url.length > 80 ? '...' : ''}`
  } else {
    status = `알 수 없는 형식  →  ${url.slice(0, 80)}`
  }

  console.log(`[${i + 1}] doc.id: ${doc.id}`)
  console.log(`     posterUrl: ${status}`)
  console.log()
})

process.exit(0)
