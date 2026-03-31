import { readFileSync } from 'fs'

// 테스트용 이미지 - scripts/crawlers/test.jpg 에 캐스팅표 이미지 저장 후 실행
const imageBuffer = readFileSync('scripts/crawlers/test.jpg')
const base64 = imageBuffer.toString('base64')

const res = await fetch('https://playpick-ai.merhen08.workers.dev/casting', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    imageBase64: base64,
    mimeType: 'image/jpeg',
    showTitle: '긴긴밤',
    castList: [
      { actorName: '홍우진', roleName: '노든' },
      { actorName: '강정우', roleName: '노든' }
    ]
  })
})

const data = await res.json()
console.log('rows:', data.rows)
console.log('debug:', data.debug)
