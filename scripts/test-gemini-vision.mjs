import { readFileSync } from 'fs'
import { config } from 'dotenv'

config({ path: '.env' })

const GEMINI_KEY = process.env.VITE_GEMINI_KEY || process.env.GEMINI_KEY

// 테스트 이미지 - 실제 존재하는 이미지 파일 사용
const imageBuffer = readFileSync('src/assets/hero.png')
const base64 = imageBuffer.toString('base64')

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: 'image/png', data: base64 } },
          { text: '이 이미지에서 텍스트를 모두 읽어줘' }
        ]
      }]
    })
  }
)

const data = await res.json()
console.log(JSON.stringify(data, null, 2))
