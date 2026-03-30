"""
kopis.py — KOPIS(공연예술통합전산망) 공공 API 공연 수집기
──────────────────────────────────────────────────────
수집 대상:
  - 서울 지역 전체 (signgucode=11)
  - 장르: 연극(AAAA) + 뮤지컬(BBAA) — shcate 파라미터로 API 필터
  - 상태: 공연중(02) + 공연예정(01) — prfstate 파라미터로 API 필터
  - 페이지당 100건, 최대 10페이지

사용법:
    python kopis.py                          # 환경변수 KOPIS_API_KEY 사용
    python kopis.py --key API_KEY            # 직접 지정
    python kopis.py --key API_KEY --days 90  # 수집 기간 90일

출력:
    pending_shows.json — upload.py와 동일한 포맷

GitHub Actions 환경변수:
    KOPIS_API_KEY: GitHub Secrets에 등록
"""

import argparse
import json
import os
import re
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path

import httpx

# ── 설정 ────────────────────────────────────────────
API_BASE    = "http://kopis.or.kr/openApi/restful"
OUTPUT_FILE = Path(__file__).parent / "pending_shows.json"

# 수집할 장르 코드 (KOPIS shcate 파라미터) — API 레벨에서 필터
# KOPIS 장르코드 전체 목록:
#   AAAA: 연극   GGGA: 뮤지컬  BBBC: 무용(서양/현대무용)
#   BSCD: 서양음악(클래식)     CCCA: 한국음악(국악)
#   CCCC: 오페라  EEEA: 복합
# ※ BBAA는 존재하지 않는 코드로 0건 반환 → GGGA로 수정
GENRE_CODES = [
    ("연극",   "AAAA"),
    ("뮤지컬", "GGGA"),  # 수정: BBAA(잘못된 코드) → GGGA(공식 뮤지컬 코드)
]

# 수집할 공연 상태 코드 (KOPIS prfstate 파라미터) — API 레벨에서 필터
STATE_CODES = [
    ("공연예정", "01"),
    ("공연중",   "02"),
]

# 최대 페이지 수 (페이지당 100건 × 최대 10페이지 = 최대 1000건/조합)
MAX_PAGES = 10

# 요청 간 대기 (KOPIS 서버 부하 방지)
REQUEST_DELAY = 0.3


# ── 유틸 ────────────────────────────────────────────
def _xml_text(el: ET.Element | None, tag: str, default: str = "") -> str:
    if el is None:
        return default
    child = el.find(tag)
    return (child.text or "").strip() if child is not None else default


def _xml_children_text(el: ET.Element | None, tag: str) -> list[str]:
    """태그 아래 모든 자식 텍스트를 리스트로 반환 (e.g. styurls > styurl)"""
    if el is None:
        return []
    parent = el.find(tag)
    if parent is None:
        return []
    return [(child.text or "").strip() for child in parent if child.text]


def parse_date(raw: str) -> str:
    """'2026.06.10' 또는 '20260610' → '2026-06-10'"""
    s = raw.strip()
    # YYYYMMDD
    if re.fullmatch(r"\d{8}", s):
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    # YYYY.MM.DD
    m = re.match(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"
    return s


def parse_runtime(text: str) -> int | None:
    """'120분', '2시간 30분', '총 90분' → 분 단위 정수"""
    text = text.strip()
    h = re.search(r"(\d+)\s*시간", text)
    m = re.search(r"(\d+)\s*분", text)
    if h:
        return int(h.group(1)) * 60 + (int(m.group(1)) if m else 0)
    return int(m.group(1)) if m else None


def parse_cast(prfcast: str) -> list[dict]:
    """
    KOPIS prfcast 는 '홍길동, 이순신, 장보고' 형태의 쉼표 구분 문자열.
    역할 정보가 없으므로 roleName 은 빈 문자열.
    """
    if not prfcast.strip():
        return []
    names = [n.strip() for n in re.split(r"[,，、\n]", prfcast) if n.strip()]

    cleaned = []
    for name in names:
        # 끝에 " 등" 제거 (예: "조영화 등" → "조영화")
        if name.endswith(" 등"):
            name = name[:-2].strip()
        # 이름이 비어있거나 1글자면 스킵
        if len(name) <= 1:
            continue
        cleaned.append({"actorName": name, "roleName": ""})
    return cleaned


def pick_ticket_url(relates_el: ET.Element | None) -> str:
    """
    <relates> 안 <relate> 목록에서 티켓 예매 URL을 우선순위로 선택.
    우선순위: 인터파크 > YES24 > 네이버예약 > 티켓링크 > 나머지 첫번째
    """
    if relates_el is None:
        return ""
    candidates = []
    for rel in relates_el.findall("relate"):
        name = (rel.findtext("relatenm") or "").strip()
        url  = (rel.findtext("relateurl") or "").strip()
        if url:
            candidates.append((name, url))
    if not candidates:
        return ""
    priority = ["인터파크", "YES24", "예스24", "네이버", "티켓링크", "멜론"]
    for keyword in priority:
        for name, url in candidates:
            if keyword in name:
                return url
    return candidates[0][1]


# ── API 호출 헬퍼 ────────────────────────────────────
def _get(client: httpx.Client, endpoint: str, params: dict) -> ET.Element | None:
    url = f"{API_BASE}/{endpoint}"
    try:
        resp = client.get(url, params=params, timeout=20)
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        # KOPIS 에러 응답 감지 (<error> 태그)
        err = root.find(".//error")
        if err is not None:
            print(f"  ⚠️  KOPIS 오류: {ET.tostring(err, encoding='unicode')}")
            return None
        return root
    except httpx.HTTPError as e:
        print(f"  ⚠️  HTTP 오류 ({endpoint}): {e}")
        return None
    except ET.ParseError as e:
        print(f"  ⚠️  XML 파싱 오류 ({endpoint}): {e}")
        return None


# ── 공연장 주소 캐시 ─────────────────────────────────
_facility_cache: dict[str, str] = {}


def get_facility_address(client: httpx.Client, api_key: str, mt10id: str) -> str:
    if not mt10id:
        return ""
    if mt10id in _facility_cache:
        return _facility_cache[mt10id]
    root = _get(client, f"prfplc/{mt10id}", {"service": api_key})
    address = ""
    if root is not None:
        db = root.find("db")
        if db is not None:
            address = _xml_text(db, "adres")
    _facility_cache[mt10id] = address
    time.sleep(REQUEST_DELAY)
    return address


# ── 목록 수집 (장르 코드 × 상태 코드 × 페이지) ────────────
def fetch_id_list(
    client:   httpx.Client,
    api_key:  str,
    stdate:   str,
    eddate:   str,
    page:     int,
    rows:     int,
    shcate:   str,   # 장르 코드: AAAA(연극) / BBAA(뮤지컬)
    prfstate: str,   # 공연 상태: 01(공연예정) / 02(공연중)
) -> tuple[list[str], int]:
    """
    공연 목록 API 한 페이지 → (mt20id 목록, 이번 페이지 건수)
    - daehakro 파라미터 제거: 서울 전체 수집
    - shcate/prfstate 로 API 레벨에서 필터링 → 클라이언트 필터 부하 최소화
    """
    params: dict = {
        "service":    api_key,
        "stdate":     stdate,
        "eddate":     eddate,
        "rows":       rows,
        "cpage":      page,
        "signgucode": "11",      # 서울 전체 (대학로 필터 제거)
        "shcate":     shcate,    # 장르 코드 — API 필터
        "prfstate":   prfstate,  # 공연 상태 코드 — API 필터
    }

    root = _get(client, "pblprfr", params)
    if root is None:
        return [], 0

    items: list[str] = []
    for db_el in root.findall("db"):
        mid = db_el.findtext("mt20id", "").strip()
        if mid:
            items.append(mid)

    total_on_page = len(root.findall("db"))
    return items, total_on_page


def collect_all_ids(
    client:      httpx.Client,
    api_key:     str,
    stdate:      str,
    eddate:      str,
    rows:        int = 100,
    genre_codes: list[tuple[str, str]] | None = None,
) -> list[str]:
    """
    장르 × 상태(공연예정/공연중) 조합으로 공연 ID 수집.
    중복 제거 후 반환. 각 조합은 최대 MAX_PAGES 페이지까지 수집.
    genre_codes: [(장르명, shcate코드), ...] — 미지정 시 GENRE_CODES 전체 사용.
    """
    active_genres = genre_codes if genre_codes is not None else GENRE_CODES
    seen:   set[str]  = set()
    result: list[str] = []

    for genre_label, shcate in active_genres:
        for state_label, prfstate in STATE_CODES:
            label = f"{genre_label}/{state_label}"
            page  = 1

            while page <= MAX_PAGES:
                print(f"  [{label}] {page}페이지 요청 (rows={rows})...")

                ids, total_on_page = fetch_id_list(
                    client, api_key, stdate, eddate,
                    page, rows, shcate, prfstate,
                )

                # 중복 없이 추가
                new_count = 0
                for mid in ids:
                    if mid not in seen:
                        seen.add(mid)
                        result.append(mid)
                        new_count += 1

                print(f"    → 이번 페이지 {total_on_page}건 / 신규 {new_count}건 (누적 {len(result)}개)")

                # 마지막 페이지 판단: 응답 건수가 요청 건수보다 적으면 종료
                if total_on_page < rows:
                    break
                page += 1
                time.sleep(REQUEST_DELAY)

    return result


# ── 공연 상세 수집 ───────────────────────────────────
def fetch_detail(client: httpx.Client, api_key: str, mt20id: str) -> dict | None:
    root = _get(client, f"pblprfr/{mt20id}", {"service": api_key})
    if root is None:
        return None
    db = root.find("db")
    if db is None:
        print(f"  ⚠️  상세 데이터 없음: {mt20id}")
        return None

    # ── 기본 필드 ──
    title = _xml_text(db, "prfnm")
    if not title:
        return None

    genre_raw = _xml_text(db, "genrenm")
    # KOPIS 장르명 → 정규화
    genre_map = {"뮤지컬": "뮤지컬", "연극": "연극"}
    genre     = genre_map.get(genre_raw, genre_raw)

    venue_raw = _xml_text(db, "fcltynm")
    # KOPIS는 "XX홀 (XX홀 부가설명)" 패턴으로 괄호 반복이 있어 첫 번째 괄호 전까지만 사용
    venue     = re.split(r"\s*\(", venue_raw)[0].strip()

    start_date = parse_date(_xml_text(db, "prfpdfrom"))
    end_date   = parse_date(_xml_text(db, "prfpdto"))
    runtime    = parse_runtime(_xml_text(db, "prfruntime"))
    cast       = parse_cast(_xml_text(db, "prfcast"))
    image_url  = _xml_text(db, "poster")
    openrun    = _xml_text(db, "openrun") == "Y"   # 오픈런 여부

    # ── 줄거리 ──
    synopsis   = _xml_text(db, "sty")
    sty_images = _xml_children_text(db, "styurls")

    # ── 티켓 URL (relates에서 추출) ──
    ticket_url = pick_ticket_url(db.find("relates"))

    # ── 공연장 주소 ──
    mt10id  = _xml_text(db, "mt10id")
    address = get_facility_address(client, api_key, mt10id)

    # ── 태그 ──
    tags: list[str] = []
    if _xml_text(db, "daehakro") == "Y":
        tags.append("대학로")
    if openrun:
        tags.append("오픈런")
    if _xml_text(db, "festival") == "Y":
        tags.append("페스티벌")
    if _xml_text(db, "musicalcreate") == "Y":
        tags.append("창작뮤지컬")

    source_url = (
        f"http://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do"
        f"?pc=02&mt20id={mt20id}"
    )

    return {
        "title":          title,
        "subtitle":       "",
        "genre":          genre,
        "venue":          venue,
        "address":        address,
        "startDate":      start_date,
        "endDate":        end_date,
        "runtime":        runtime,
        "synopsis":       synopsis,
        "synopsisImages": sty_images,
        "ticketUrl":      ticket_url,
        "imageUrl":       image_url,
        "cast":           cast,
        "tags":           tags,
        "source":         "KOPIS",
        "sourceUrl":      source_url,
        "collectedAt":    datetime.now().isoformat(),
        "status":         "pending",
    }


# ── 메인 ────────────────────────────────────────────
def main(api_key: str, days: int = 180, rows: int = 100,
         genre_codes: list[tuple[str, str]] | None = None) -> None:
    # genre_codes 미지정 시 전체 장르(연극+뮤지컬) 수집
    active_genres = genre_codes if genre_codes is not None else GENRE_CODES

    today  = datetime.today()
    stdate = today.strftime("%Y%m%d")
    eddate = (today + timedelta(days=days)).strftime("%Y%m%d")

    genre_labels = " / ".join(f"{l}({c})" for l, c in active_genres)
    state_labels = " / ".join(f"{l}({c})" for l, c in STATE_CODES)

    print(f"🎭 KOPIS 공연 수집 시작")
    print(f"   기간   : {stdate} ~ {eddate} ({days}일)")
    print(f"   장르   : {genre_labels}")
    print(f"   상태   : {state_labels}")
    print(f"   지역   : 서울(signgucode=11)")
    print(f"   페이지 : 최대 {MAX_PAGES}페이지 × {rows}건")

    all_shows: list[dict] = []

    with httpx.Client(follow_redirects=True, timeout=20) as client:
        # 1단계: 공연 ID 목록 수집
        print("\n[1단계] 공연 ID 목록 수집")
        mt20ids = collect_all_ids(client, api_key, stdate, eddate, rows, active_genres)
        print(f"\n  → 수집 대상 ID: 총 {len(mt20ids)}개\n")

        if len(mt20ids) == 0:
            print("⚠️  수집된 공연이 없습니다. API 키와 파라미터를 확인하세요.")
            return

        # 2단계: 공연별 상세 수집
        print("[2단계] 공연 상세 수집")
        skipped = 0
        for i, mt20id in enumerate(mt20ids, 1):
            print(f"  [{i}/{len(mt20ids)}] {mt20id}", end=" ")
            show = fetch_detail(client, api_key, mt20id)
            if show:
                all_shows.append(show)
                print(f"✅ [{show['genre']}] {show['title'][:30]}"
                      f" ({show['startDate']} ~ {show['endDate']})")
            else:
                skipped += 1
                print("⚠️  스킵")
            time.sleep(REQUEST_DELAY)

    # ── 수집 결과 요약 출력 ──────────────────────────
    genre_count = {}
    for show in all_shows:
        genre_count[show["genre"]] = genre_count.get(show["genre"], 0) + 1

    print(f"\n{'='*50}")
    print(f"✅ 수집 완료")
    print(f"   성공: {len(all_shows)}개 / 스킵: {skipped}개 / 대상: {len(mt20ids)}개")
    for genre, cnt in sorted(genre_count.items()):
        print(f"   - {genre}: {cnt}개")
    print(f"{'='*50}")

    # 저장
    OUTPUT_FILE.write_text(
        json.dumps(all_shows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"📁 저장 완료: {OUTPUT_FILE}")


# ── CLI ─────────────────────────────────────────────
def _get_api_key(cli_key: str | None) -> str:
    key = cli_key or os.environ.get("KOPIS_API_KEY", "")
    if not key:
        raise SystemExit(
            "❌ KOPIS API 키가 없습니다.\n"
            "  방법 1: python kopis.py --kopis-key YOUR_KEY\n"
            "  방법 2: export KOPIS_API_KEY=YOUR_KEY\n"
            "  키 발급: https://www.kopis.or.kr/por/cs/openapi/openApiGuide.do"
        )
    return key


def _init_firebase(key_path: str | None):
    """Firebase Admin SDK 초기화 후 Firestore 클라이언트 반환."""
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore as fs
    except ImportError:
        raise SystemExit("❌ firebase-admin 패키지가 필요합니다: pip install firebase-admin")

    if firebase_admin._apps:
        return fs.client()

    if key_path:
        cred = credentials.Certificate(key_path)
    else:
        json_str = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        if not json_str:
            raise SystemExit(
                "❌ Firebase 인증 정보가 없습니다.\n"
                "  --firebase-key 옵션 또는 FIREBASE_SERVICE_ACCOUNT_JSON 환경변수를 설정하세요."
            )
        tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        tmp.write(json_str)
        tmp.close()
        cred = credentials.Certificate(tmp.name)
        os.unlink(tmp.name)

    firebase_admin.initialize_app(cred)
    return fs.client()


def _extract_mt20id(doc_data: dict) -> str | None:
    """
    Firestore shows 문서에서 KOPIS mt20id 추출.
    우선순위: kopisId 필드 → sourceUrl에서 파싱
    """
    mid = doc_data.get("kopisId", "").strip()
    if mid:
        return mid
    source_url = doc_data.get("sourceUrl", "")
    m = re.search(r"mt20id=([A-Z0-9]+)", source_url)
    return m.group(1) if m else None


def synopsis_only(kopis_key: str, firebase_key: str | None, limit: int | None) -> None:
    """
    shows 컬렉션에서 synopsis 없는 공연을 찾아
    KOPIS API로 synopsis / synopsisImages 만 업데이트.
    """
    db = _init_firebase(firebase_key)

    print("🔍 synopsis 없는 공연 조회 중...")
    # select로 필요한 필드만 읽어 읽기 비용 최소화
    docs = list(
        db.collection("shows")
          .select(["synopsis", "kopisId", "sourceUrl", "title"])
          .stream()
    )

    targets = []
    for d in docs:
        data = d.to_dict()
        if not (data.get("synopsis") or "").strip():
            mid = _extract_mt20id(data)
            if mid:
                targets.append((d.id, data.get("title", ""), mid))

    total_no_syn = len([d for d in docs if not (d.to_dict().get("synopsis") or "").strip()])
    total_no_id  = total_no_syn - len(targets)

    print(f"   shows 전체: {len(docs)}개")
    print(f"   synopsis 없음: {total_no_syn}개")
    print(f"   → kopisId 없어 스킵: {total_no_id}개")
    print(f"   → 처리 대상: {len(targets)}개")

    if limit:
        targets = targets[:limit]
        print(f"   → --limit {limit} 적용: {len(targets)}개만 처리\n")
    else:
        print()

    if not targets:
        print("처리할 공연이 없습니다.")
        return

    updated = 0
    skipped = 0

    with httpx.Client(follow_redirects=True, timeout=20) as client:
        for idx, (doc_id, title, mt20id) in enumerate(targets, 1):
            print(f"[{idx}/{len(targets)}] {title[:30]} ({mt20id})", end=" ")

            root = _get(client, f"pblprfr/{mt20id}", {"service": kopis_key})
            if root is None:
                print("⚠️  API 오류 스킵")
                skipped += 1
                time.sleep(REQUEST_DELAY)
                continue

            db_el = root.find("db")
            if db_el is None:
                print("⚠️  데이터 없음 스킵")
                skipped += 1
                time.sleep(REQUEST_DELAY)
                continue

            synopsis   = _xml_text(db_el, "sty")
            sty_images = _xml_children_text(db_el, "styurls")

            if not synopsis.strip() and not sty_images:
                print("— synopsis 없음 (KOPIS에도 없음)")
                skipped += 1
            else:
                update = {}
                if synopsis.strip():
                    update["synopsis"] = synopsis
                if sty_images:
                    update["synopsisImages"] = sty_images
                try:
                    db.collection("shows").document(doc_id).update(update)
                    print(f"✅ 저장 (synopsis {len(synopsis)}자, 이미지 {len(sty_images)}개)")
                    updated += 1
                except Exception as e:
                    print(f"❌ 저장 실패: {e}")
                    skipped += 1

            time.sleep(REQUEST_DELAY)

    print(f"""
──────────────────────────────────────
synopsis 보완 완료
  ✅ 업데이트: {updated}개
  ⏭️  스킵:    {skipped}개
──────────────────────────────────────""")


def probe(api_key: str) -> None:
    """
    --probe 모드: 여러 shcate 코드로 각 1페이지씩 요청 후
    반환된 genrenm 값과 건수를 출력해 올바른 코드를 확인한다.
    signgucode 없이 전국 기준으로 요청해 필터 오류 가능성을 배제한다.
    """
    today  = datetime.today().strftime("%Y%m%d")
    end    = (datetime.today() + timedelta(days=180)).strftime("%Y%m%d")

    # 테스트할 shcate 코드 후보 (KOPIS 공식 장르코드 전체)
    candidates = [
        ("AAAA", "연극"),
        ("GGGA", "뮤지컬(추정)"),
        ("BBAA", "뮤지컬(기존코드)"),
        ("BBBC", "무용(서양/현대)"),
        ("BSCD", "서양음악(클래식)"),
        ("CCCA", "한국음악(국악)"),
        ("CCCC", "오페라"),
        ("EEEA", "복합"),
    ]

    print("🔍 KOPIS shcate 코드 진단 (전국, 1페이지, rows=5)")
    print(f"   기간: {today} ~ {end}")
    print(f"   ※ signgucode 없음 — 필터 오류 배제용\n")

    # 테스트 URL 출력 (브라우저에서 직접 확인 가능)
    print("━" * 60)
    print("📋 브라우저 테스트 URL (YOUR_API_KEY 교체 후 접속)")
    print("━" * 60)
    for code, label in candidates:
        url = (
            f"{API_BASE}/pblprfr"
            f"?service=YOUR_API_KEY"
            f"&stdate={today}&eddate={end}"
            f"&rows=5&cpage=1"
            f"&shcate={code}"
        )
        print(f"  [{code}] {label}")
        print(f"  {url}\n")

    # 실제 API 호출로 결과 확인
    print("━" * 60)
    print("🌐 실제 API 호출 결과")
    print("━" * 60)

    with httpx.Client(follow_redirects=True, timeout=15) as client:
        for code, label in candidates:
            params = {
                "service": api_key,
                "stdate":  today,
                "eddate":  end,
                "rows":    5,
                "cpage":   1,
                "shcate":  code,
            }
            root = _get(client, "pblprfr", params)
            if root is None:
                print(f"  [{code}] {label}: 요청 실패")
                continue

            dbs = root.findall("db")
            genres = list({d.findtext("genrenm", "").strip() for d in dbs if d.findtext("genrenm")})
            titles = [d.findtext("prfnm", "")[:20] for d in dbs[:2]]
            print(f"  [{code}] {label}: {len(dbs)}건  genrenm={genres}  예시={titles}")
            time.sleep(REQUEST_DELAY)

    print("\n✅ 진단 완료 — 건수가 있는 코드가 유효한 장르코드입니다.")
    print("   kopis.py의 GENRE_CODES에서 GGGA 코드 확인 후 수정하세요.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="KOPIS 공공 API 공연 크롤러 (연극+뮤지컬, 서울 전체)"
    )
    # ── KOPIS 키 (기존 --key 유지 + --kopis-key 별칭 추가) ──
    parser.add_argument("--kopis-key", "--key", dest="kopis_key",
                        default=None, help="KOPIS API 키 (없으면 KOPIS_API_KEY 환경변수)")
    # ── Firebase 키 (synopsis-only 모드용) ──
    parser.add_argument("--firebase-key", dest="firebase_key",
                        default=None, help="Firebase 서비스 계정 JSON 파일 경로")
    parser.add_argument("--days",   type=int, default=180, help="수집 기간(일) (기본 180)")
    parser.add_argument("--rows",   type=int, default=100, help="페이지당 건수 (기본 100, 최대 100)")
    parser.add_argument("--output", default=None, help="출력 파일 경로 (기본: pending_shows.json)")
    parser.add_argument(
        "--genre",
        default="all",
        choices=["all", "play", "musical"],
        help="수집 장르: all=연극+뮤지컬(기본) / play=연극만 / musical=뮤지컬만",
    )
    parser.add_argument(
        "--probe",
        action="store_true",
        help="진단 모드: 여러 shcate 코드를 실제 API로 테스트해 올바른 코드를 확인",
    )
    parser.add_argument(
        "--synopsis-only",
        action="store_true",
        dest="synopsis_only",
        help="synopsis 보완 모드: shows 컬렉션에서 synopsis 없는 공연만 KOPIS API로 업데이트",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="처리할 최대 공연 수 (테스트용, 기본값: 제한 없음)",
    )
    args = parser.parse_args()

    if args.output:
        OUTPUT_FILE = Path(args.output)

    # --probe: 장르코드 진단 후 종료
    if args.probe:
        probe(_get_api_key(args.kopis_key))
        raise SystemExit(0)

    # --synopsis-only: synopsis 보완 후 종료
    if args.synopsis_only:
        synopsis_only(
            kopis_key=_get_api_key(args.kopis_key),
            firebase_key=args.firebase_key,
            limit=args.limit,
        )
        raise SystemExit(0)

    # ── 기본 모드: 공연 수집 ──
    GENRE_FILTER = {
        "all":     None,
        "play":    [("연극",   "AAAA")],
        "musical": [("뮤지컬", "GGGA")],
    }

    main(
        api_key=_get_api_key(args.kopis_key),
        days=args.days,
        rows=args.rows,
        genre_codes=GENRE_FILTER[args.genre],
    )
