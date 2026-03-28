"""
kopis.py — KOPIS(공연예술통합전산망) 공공 API 공연 수집기
──────────────────────────────────────────────────────
수집 대상:
  - 서울 지역 전체 (signgucode=11)
  - 대학로 공연 (daehakro=Y)
  - 장르: 연극 + 뮤지컬만 클라이언트 필터링

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
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path

import httpx

# ── 설정 ────────────────────────────────────────────
API_BASE    = "http://kopis.or.kr/openApi/restful"
OUTPUT_FILE = Path(__file__).parent / "pending_shows.json"

# 수집할 장르 (KOPIS genrenm 기준 — 이 값으로 클라이언트 필터링)
TARGET_GENRES = {"연극", "뮤지컬"}

# 수집할 지역 (KOPIS area 기준 — signgucode=11 으로 API 필터 + 이 값으로 이중 검증)
TARGET_AREA = "서울특별시"

# 공연 상태 (공연예정 + 공연중)
TARGET_STATES = {"공연예정", "공연중"}

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
    return [{"actorName": name, "roleName": ""} for name in names]


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


# ── 목록 수집 (서울 전체 / 대학로) ───────────────────
def fetch_id_list(
    client: httpx.Client,
    api_key: str,
    stdate: str,
    eddate: str,
    page: int,
    rows: int,
    daehakro: bool = False,
) -> tuple[list[str], int]:
    """
    공연 목록 API 한 페이지 → (mt20id 목록, 총 건수)
    daehakro=True 이면 대학로 필터 적용.
    장르 필터(shcate)는 이 API 키에서 작동하지 않아 클라이언트 필터링으로 대체.
    """
    params: dict = {
        "service":    api_key,
        "stdate":     stdate,
        "eddate":     eddate,
        "rows":       rows,
        "cpage":      page,
        "signgucode": "11",   # 서울
    }
    if daehakro:
        params["daehakro"] = "Y"

    root = _get(client, "pblprfr", params)
    if root is None:
        return [], 0

    items: list[str] = []
    for db in root.findall("db"):
        genre  = db.findtext("genrenm", "").strip()
        state  = db.findtext("prfstate", "").strip()
        area   = db.findtext("area", "").strip()
        # 장르: 연극·뮤지컬 / 지역: 서울특별시 / 상태: 예정·공연중
        if (genre in TARGET_GENRES
                and state in TARGET_STATES
                and area == TARGET_AREA):
            mid = db.findtext("mt20id", "").strip()
            if mid:
                items.append(mid)

    # KOPIS 는 총 건수 태그가 없어 수신 건수로 마지막 페이지 판단
    total_on_page = len(root.findall("db"))
    return items, total_on_page


def collect_all_ids(
    client: httpx.Client,
    api_key: str,
    stdate: str,
    eddate: str,
    rows: int = 100,
) -> list[str]:
    """서울 전체 + 대학로 공연 ID를 중복 없이 수집"""
    seen: set[str] = set()
    result: list[str] = []

    # 대학로(daehakro=Y)를 먼저 수집해 우선순위 부여, 이후 서울 전체로 나머지 보완
    for label, daehakro in [("대학로(daehakro=Y)", True), ("서울 전체", False)]:
        page = 1
        while True:
            print(f"  [{label}] 목록 {page}페이지 요청...")
            ids, total_on_page = fetch_id_list(
                client, api_key, stdate, eddate, page, rows, daehakro
            )
            for mid in ids:
                if mid not in seen:
                    seen.add(mid)
                    result.append(mid)
            print(f"    → 이번 페이지 {total_on_page}건 중 필터 통과 {len(ids)}건 (누적 {len(result)}개)")
            if total_on_page < rows:
                break   # 마지막 페이지
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
    title       = _xml_text(db, "prfnm")
    if not title:
        return None

    genre_raw   = _xml_text(db, "genrenm")
    # KOPIS 장르명 → 정규화
    genre_map   = {"뮤지컬": "뮤지컬", "연극": "연극"}
    genre       = genre_map.get(genre_raw, genre_raw)

    venue_raw   = _xml_text(db, "fcltynm")
    # KOPIS는 "XX홀 (XX홀 부가설명)" 패턴으로 괄호 반복이 있어 첫 번째 괄호 전까지만 사용
    venue       = re.split(r"\s*\(", venue_raw)[0].strip()

    start_date  = parse_date(_xml_text(db, "prfpdfrom"))
    end_date    = parse_date(_xml_text(db, "prfpdto"))
    runtime     = parse_runtime(_xml_text(db, "prfruntime"))
    cast        = parse_cast(_xml_text(db, "prfcast"))
    image_url   = _xml_text(db, "poster")
    openrun     = _xml_text(db, "openrun") == "Y"   # 오픈런 여부

    # ── 줄거리 ──
    # sty 필드(텍스트) + styurls(이미지 URL 목록) 병합
    synopsis    = _xml_text(db, "sty")
    sty_images  = _xml_children_text(db, "styurls")

    # ── 티켓 URL (relates에서 추출) ──
    ticket_url  = pick_ticket_url(db.find("relates"))

    # ── 공연장 주소 ──
    mt10id      = _xml_text(db, "mt10id")
    address     = get_facility_address(client, api_key, mt10id)

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
        "title":      title,
        "subtitle":   "",
        "genre":      genre,
        "venue":      venue,
        "address":    address,
        "startDate":  start_date,
        "endDate":    end_date,
        "runtime":    runtime,
        "synopsis":   synopsis,
        "synopsisImages": sty_images,   # 줄거리 이미지 (없으면 [])
        "ticketUrl":  ticket_url,
        "imageUrl":   image_url,
        "cast":       cast,             # [{actorName, roleName}]
        "tags":       tags,
        "source":     "KOPIS",
        "sourceUrl":  source_url,
        "collectedAt": datetime.now().isoformat(),
        "status":     "pending",
    }


# ── 메인 ────────────────────────────────────────────
def main(api_key: str, days: int = 180, rows: int = 100) -> None:
    today  = datetime.today()
    stdate = today.strftime("%Y%m%d")
    eddate = (today + timedelta(days=days)).strftime("%Y%m%d")

    print(f"🎭 KOPIS 공연 수집 시작")
    print(f"   기간: {stdate} ~ {eddate} ({days}일)")
    print(f"   장르: {', '.join(TARGET_GENRES)}")

    all_shows: list[dict] = []

    with httpx.Client(follow_redirects=True, timeout=20) as client:
        # 1단계: 공연 ID 목록 수집 (서울 전체 + 대학로)
        print("\n[1단계] 공연 ID 목록 수집")
        mt20ids = collect_all_ids(client, api_key, stdate, eddate, rows)
        print(f"  → 수집 대상: 총 {len(mt20ids)}개 공연\n")

        # 2단계: 공연별 상세 수집
        print("[2단계] 공연 상세 수집")
        for i, mt20id in enumerate(mt20ids, 1):
            print(f"  [{i}/{len(mt20ids)}] {mt20id}", end=" ")
            show = fetch_detail(client, api_key, mt20id)
            if show:
                all_shows.append(show)
                print(f"✅ [{show['genre']}] {show['title'][:30]}"
                      f" ({show['startDate']} ~ {show['endDate']})")
            else:
                print("⚠️  스킵")
            time.sleep(REQUEST_DELAY)

    # 저장
    OUTPUT_FILE.write_text(
        json.dumps(all_shows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n✅ 수집 완료: 총 {len(all_shows)}개 → {OUTPUT_FILE}")


# ── CLI ─────────────────────────────────────────────
def _get_api_key(cli_key: str | None) -> str:
    key = cli_key or os.environ.get("KOPIS_API_KEY", "")
    if not key:
        raise SystemExit(
            "❌ KOPIS API 키가 없습니다.\n"
            "  방법 1: python kopis.py --key YOUR_KEY\n"
            "  방법 2: export KOPIS_API_KEY=YOUR_KEY\n"
            "  키 발급: https://www.kopis.or.kr/por/cs/openapi/openApiGuide.do"
        )
    return key


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KOPIS 공공 API 공연 크롤러 (연극+뮤지컬, 서울+대학로)")
    parser.add_argument("--key",    default=None, help="KOPIS API 키 (없으면 KOPIS_API_KEY 환경변수)")
    parser.add_argument("--days",   type=int, default=180, help="수집 기간(일) (기본 180)")
    parser.add_argument("--rows",   type=int, default=100, help="페이지당 건수 (기본 100, 최대 100)")
    parser.add_argument("--output", default=None, help="출력 파일 경로 (기본: pending_shows.json)")
    args = parser.parse_args()

    if args.output:
        OUTPUT_FILE = Path(args.output)

    main(
        api_key=_get_api_key(args.key),
        days=args.days,
        rows=args.rows,
    )
