# 🎭 막이 오르면 — 서울 공연 아카이브

대학로 중심의 연극·뮤지컬 공연 정보 아카이브 사이트입니다.  
배우의 키워드 투표, 출연 이력, 댓글 기능을 포함합니다.

---

## 이 프로젝트가 무엇인가요?

| 기능 | 상태 |
|------|------|
| 공연 목록 + 오늘 공연 필터 | ✅ MVP 포함 |
| 공연 상세 (출연진, 정보, 예매 링크) | ✅ MVP 포함 |
| 배우 상세 + 출연 이력 | ✅ MVP 포함 |
| 키워드 투표 (관객이 배우에 키워드 누름) | ✅ MVP 포함 |
| 키워드 노선 막대 그래프 | ✅ MVP 포함 |
| 댓글 (공연/배우 단위) | ✅ MVP 포함 |
| 관리자 JSON 업로드 | ✅ MVP 포함 |
| 이미지 업로드 | 🔲 2차 예정 |
| 공연 자동 크롤링 | 🔲 3차 예정 |

---

## 폴더 구조

```
theater-archive/
├── public/
│   └── favicon.svg
├── src/
│   ├── components/         ← 여러 페이지에서 공통으로 쓰이는 UI 조각
│   │   ├── Layout.jsx      ← Navbar + Footer 공통 껍데기
│   │   ├── Navbar.jsx      ← 상단 메뉴
│   │   ├── ShowCard.jsx    ← 공연 목록 카드
│   │   ├── KeywordVote.jsx ← 키워드 투표 버튼들
│   │   └── CommentSection.jsx ← 댓글 영역
│   ├── pages/              ← URL 하나에 파일 하나 (라우팅 기준)
│   │   ├── HomePage.jsx    ← "/" 공연 목록
│   │   ├── ShowPage.jsx    ← "/shows/:id" 공연 상세
│   │   ├── ActorPage.jsx   ← "/actors/:id" 배우 상세
│   │   └── AdminPage.jsx   ← "/admin" 관리자
│   ├── hooks/              ← 데이터를 불러오는 로직 (Firebase 또는 더미)
│   │   ├── useAuth.js      ← 익명 로그인
│   │   ├── useShows.js     ← 공연 목록 / 단일 공연
│   │   └── useActor.js     ← 배우 정보
│   ├── data/
│   │   └── sampleShows.json ← 더미 공연 데이터 5개
│   ├── firebase.js         ← Firebase 초기화 (건드리지 마세요)
│   ├── App.jsx             ← 라우팅 설정
│   ├── main.jsx            ← React 진입점
│   └── index.css           ← 전역 스타일
├── .env.example            ← 환경변수 템플릿 (.env 파일 만들 때 복사)
├── .firebaserc.example     ← Firebase 프로젝트 연결 템플릿
├── firebase.json           ← Firebase Hosting 설정
├── firestore.rules         ← Firestore 보안 규칙
├── firestore.indexes.json  ← Firestore 인덱스
├── vite.config.js
├── tailwind.config.js
└── package.json
```

---

## 로컬에서 실행하는 방법

### ① Node.js 설치 확인

터미널(Terminal / PowerShell)에서:
```bash
node -v
```
버전이 나오면 OK. 없으면 https://nodejs.org 에서 LTS 버전 설치.

### ② 프로젝트 폴더로 이동

```bash
cd theater-archive
```

### ③ 패키지 설치

```bash
npm install
```

> 처음 한 번만 실행하면 됩니다. `node_modules/` 폴더가 생깁니다.

### ④ 환경변수 파일 만들기

```bash
cp .env.example .env
```

> `.env` 파일은 지금 당장 수정하지 않아도 됩니다.  
> Firebase 연결 전에는 더미 데이터로 사이트가 실행됩니다.

### ⑤ 개발 서버 실행

```bash
npm run dev
```

브라우저에서 http://localhost:5173 열기.  
더미 데이터로 사이트가 바로 뜹니다! ✅

---

## Firebase 연결 방법

### 1단계 — Firebase 프로젝트 만들기

1. https://console.firebase.google.com 접속
2. **프로젝트 추가** 클릭
3. 프로젝트 이름 입력 (예: `theater-archive`)
4. Google Analytics: 일단 **사용 안 함** 선택
5. 프로젝트 생성 완료

### 2단계 — 웹 앱 등록

1. 프로젝트 홈 → **</>** (웹) 아이콘 클릭
2. 앱 닉네임 입력 (예: `theater-web`)
3. **"Firebase Hosting도 설정"** 체크 ✅
4. `firebaseConfig` 코드 블록이 나오면 값들을 복사

### 3단계 — .env 파일에 값 붙여넣기

`.env` 파일을 텍스트 에디터로 열고:

```
VITE_FIREBASE_API_KEY=여기에_apiKey_값
VITE_FIREBASE_AUTH_DOMAIN=여기에_authDomain_값
VITE_FIREBASE_PROJECT_ID=여기에_projectId_값
VITE_FIREBASE_STORAGE_BUCKET=여기에_storageBucket_값
VITE_FIREBASE_MESSAGING_SENDER_ID=여기에_messagingSenderId_값
VITE_FIREBASE_APP_ID=여기에_appId_값
```

저장 후 `npm run dev` 재실행.

### 4단계 — Firestore 활성화

1. Firebase Console 좌측 → **Firestore Database**
2. **데이터베이스 만들기** 클릭
3. **프로덕션 모드** 선택 (보안 규칙은 바로 배포할 것)
4. 위치: `asia-northeast3` (서울) 선택

### 5단계 — 익명 인증 활성화

1. Firebase Console 좌측 → **Authentication**
2. **시작하기** 클릭
3. **로그인 방법** 탭 → **익명** → 사용 설정

---

## Firebase Hosting 배포 방법

### 처음 한 번

```bash
# Firebase CLI 설치 (처음만)
npm install -g firebase-tools

# Firebase 로그인
firebase login

# 프로젝트 연결 (.firebaserc 생성)
firebase use --add
# 프로젝트 목록에서 방금 만든 프로젝트 선택

# 보안 규칙 배포
firebase deploy --only firestore:rules
```

### 매번 배포할 때

```bash
# 1. 빌드
npm run build

# 2. 배포
firebase deploy --only hosting
```

완료되면 `https://YOUR_PROJECT.web.app` 에서 사이트가 열립니다!

---

## 초보자가 가장 자주 틀리는 지점 ⚠️

| 문제 | 원인 | 해결 |
|------|------|------|
| `npm install` 후 아무것도 안 됨 | Node.js 미설치 | https://nodejs.org 에서 설치 |
| 화면에 아무것도 안 뜸 | 5173 포트 충돌 | 브라우저에서 `localhost:5173` 정확히 입력 |
| Firebase 연결 후 데이터 없음 | Firestore에 데이터가 없음 | 관리자 페이지에서 샘플 업로드 |
| 투표가 안 됨 | 익명 인증 미활성화 | Firebase Console → Authentication → 익명 사용 설정 |
| 배포 후 페이지 새로고침 404 | SPA rewrite 누락 | `firebase.json`에 rewrites 설정 확인 (이미 포함됨) |
| `.env` 수정 후 변화 없음 | 서버 재시작 필요 | `Ctrl+C`로 종료 후 `npm run dev` 다시 실행 |
| `VITE_` 없는 환경변수 | Vite는 `VITE_` 접두사 필수 | `.env`의 모든 변수가 `VITE_`로 시작하는지 확인 |
| 보안 규칙 오류 | 규칙 미배포 | `firebase deploy --only firestore:rules` |

---

## 데이터 추가하는 법 (빠른 방법)

1. 브라우저에서 `/admin` 접속
2. 비밀번호: `theater2025` (`.env`에서 변경 가능)
3. **"샘플 5개 불러오기"** 클릭
4. **"Firestore에 업로드"** 클릭
5. 홈으로 돌아가면 공연 5개가 보임 ✅

---

## 다음 확장 아이디어 (2차 / 3차)

**2차:**
- 공연 이미지 Firebase Storage 업로드
- 배우 프로필 관리자 등록
- 검색 기능 (이름/태그)
- 공연 날짜 캘린더 뷰

**3차:**
- 인터파크/예스24 공연 정보 크롤러
- 수동 승인 후 Firestore 저장 워크플로우
- Firebase Auth 이메일 로그인 + 관리자 역할
- 관람 기록 / 위시리스트 기능

---

*MVP v0.1 · Vite + React + Firebase*
