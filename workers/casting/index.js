// ─────────────────────────────────────────────
// Cloudflare Worker — /casting
// Gemini Vision으로 캐스팅 사진 분석
// ─────────────────────────────────────────────
// 배포: wrangler deploy
// 환경변수: GEMINI_API_KEY (wrangler secret put GEMINI_API_KEY)
// ─────────────────────────────────────────────

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin':  '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405)
    }

    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: '요청 파싱 실패' }, 400)
    }

    const { imageBase64, mimeType, castList = [], showTitle = '' } = body
    if (!imageBase64 || !mimeType) {
      return json({ error: 'imageBase64, mimeType 필수' }, 400)
    }

    // ── 프롬프트 구성 ──────────────────────────
    const castJson = JSON.stringify(castList)
    const hasCast  = castList.length > 0

    const promptText = hasCast
      ? `이 캐스팅 안내 이미지에서 날짜와 배우 이름을 추출해줘.

아래 cast 목록을 참고해서 역할명을 매칭해줘:
${castJson}

규칙:
- 배우 이름이 cast 목록에 있으면 그 roleName 사용
- cast 목록에 없으면 roleName을 빈 문자열로
- 날짜는 YYYY-MM-DD 형식으로
- 공연명은 "${showTitle || '공연명 직접 읽기'}" 사용
- 반드시 JSON만 반환: { "rows": [{ "date": "", "showTitle": "", "actorName": "", "roleName": "" }] }`
      : `이 캐스팅 안내 이미지에서 날짜, 공연명, 배우 이름, 역할명을 추출해줘.

규칙:
- 날짜는 YYYY-MM-DD 형식으로
- 이미지에서 읽은 값 그대로 사용
- 반드시 JSON만 반환: { "rows": [{ "date": "", "showTitle": "", "actorName": "", "roleName": "" }] }`

    // ── Gemini API 호출 ────────────────────────
    const geminiRes = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptText },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        }],
        generationConfig: {
          temperature:     0.1,
          responseMimeType: 'application/json',
        },
      }),
    })

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      return json({ error: `Gemini 오류 ${geminiRes.status}`, detail: errText }, 502)
    }

    const geminiData = await geminiRes.json()

    // 응답에서 텍스트 추출
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    // JSON 파싱 시도
    let parsed
    try {
      // ```json ... ``` 코드블록 제거 후 파싱
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      // 파싱 실패 시 rawText 그대로 반환
      return json({ error: 'JSON 파싱 실패', rawText }, 200)
    }

    return json(parsed)
  },
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
