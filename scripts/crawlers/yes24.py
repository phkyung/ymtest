"""
yes24.py — 예스24 티켓 공연 수집 크롤러
────────────────────────────────────────
수집 조건:
  - 장르: 뮤지컬 + 연극만 (상세 페이지 HidIdGenre 필드로 검증)
  - 지역: 서울만 (상세 페이지 HidRegionName 필드로 검증)

※ 예스24 목록 AJAX는 장르·지역 파라미터가 실제로 필터링하지 않아
  상세 페이지를 가져온 후 HidIdGenre / HidRegionName 필드로 판별합니다.

사용법:
    python yes24.py                 # 기본 실행 (최대 5페이지)
    python yes24.py --pages 10      # 최대 10페이지
    python yes24.py --size 50       # 페이지당 50건

출력:
    pending_shows.json — upload.py와 동일한 포맷
"""

import argparse
import json
import re
import time
import random
from datetime import datetime
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

# ── 설정 ────────────────────────────────────────
BASE_URL    = "https://ticket.yes24.com"
AJAX_URL    = f"{BASE_URL}/New/Genre/Ajax/GenreList_Data.aspx"
DETAIL_URL  = f"{BASE_URL}/Perf/{{perf_id}}"
OUTPUT_FILE = Path(__file__).parent / "pending_shows.json"

# 수집 대상 장르 (HidIdGenre 기준)
# 예스24 목록 AJAX의 genre 파라미터는 실제로 필터링하지 않으므로
# 상세 페이지 HidIdGenre 필드로 판별해 연극·뮤지컬만 수집
TARGET_GENRE_IDS = {"15457", "15458"}   # 15457=뮤지컬, 15458=연극

# HidIdGenre → 한국어
GENRE_ID_MAP = {
    "15456": "콘서트",
    "15457": "뮤지컬",
    "15458": "연극",
    "15459": "클래식",
    "15460": "전시/행사",
    "15461": "가족/어린이",
}

# 목록 AJAX 요청에 사용할 genre 코드 (실제 필터 효과 없으나 필수 파라미터)
_LIST_GENRE_CODE = "0"   # 전체 (어차피 필터 미작동)

# 요청 사이 랜덤 딜레이 (초)
DELAY_MIN = 1.5
DELAY_MAX = 3.0

# Chrome 124 실제 브라우저 헤더
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.6367.207 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;"
        "q=0.9,image/avif,image/webp,image/apng,*/*;"
        "q=0.8,application/signed-exchange;v=b3;q=0.7"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
    "DNT": "1",
}


def _delay() -> None:
    time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))


def _get_machine_token(client: httpx.Client) -> str:
    """
    목록 페이지를 방문해 세션 쿠키와 machine 토큰을 획득.
    예스24 AJAX는 이 값이 없으면 빈 결과를 반환.
    """
    list_page = f"{BASE_URL}/New/Genre/GenreList.aspx?genretype=1&genre={_LIST_GENRE_CODE}"
    r = client.get(list_page, headers=HEADERS)
    soup = BeautifulSoup(r.text, "html.parser")
    el = soup.select_one("input[name='machine']")
    return el["value"] if el else ""


def parse_runtime(text: str) -> int | None:
    """'총 120분(인터미션 없음)' → 120 / '2시간 30분' → 150"""
    h = re.search(r"(\d+)\s*시간", text)
    m = re.search(r"(\d+)\s*분", text)
    if h:
        return int(h.group(1)) * 60 + (int(m.group(1)) if m else 0)
    return int(m.group(1)) if m else None


# ── 목록 AJAX 호출 ───────────────────────────────
def fetch_list(
    client: httpx.Client,
    machine: str,
    page: int,
    page_size: int,
) -> tuple[list[str], int]:
    """
    예스24 공연 목록 AJAX → (공연 ID 목록, 전체 건수) 반환.
    반드시 POST + machine 토큰 + 세션 쿠키가 있어야 결과가 옴.

    ※ genre/area 파라미터는 이 API에서 실제로 필터링하지 않음.
       장르·지역 필터는 fetch_detail 내부에서 수행.
    """
    print(f"\n📄 목록 {page}페이지 요청 중...")

    data = {
        "genre":     _LIST_GENRE_CODE,
        "sort":      "3",   # 인기순
        "area":      "",
        "genretype": "1",
        "pCurPage":  str(page),
        "pPageSize": str(page_size),
        "machine":   machine,
    }
    ajax_headers = {
        **HEADERS,
        "Accept": "*/*",
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": f"{BASE_URL}/New/Genre/GenreList.aspx?genretype=1&genre={_LIST_GENRE_CODE}",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "X-Requested-With": "XMLHttpRequest",
    }

    try:
        r = client.post(AJAX_URL, data=data, headers=ajax_headers, timeout=15)
        r.raise_for_status()
    except httpx.HTTPError as e:
        print(f"  ⚠️  목록 요청 실패: {e}")
        return [], 0

    soup = BeautifulSoup(r.text, "html.parser")

    total_el = soup.select_one("#ListTotalCnt")
    total = int(total_el["value"]) if total_el else 0
    print(f"  → 전체 {total}건 중 {page}페이지")

    perf_ids = []
    for a in soup.select("div.ms-list-imgs a"):
        onclick = a.get("onclick", "")
        m = re.search(r"GoToPerfDetail\((\d+)\)", onclick)
        if m:
            perf_ids.append(m.group(1))

    print(f"  → ID {len(perf_ids)}개 수신")
    return perf_ids, total


# ── 상세 페이지 파싱 ─────────────────────────────
def fetch_detail(client: httpx.Client, perf_id: str) -> dict | None:
    """
    /Perf/{id} 페이지의 JSON-LD(schema.org Event)를 파싱.
    상세 페이지에는 구조화된 데이터가 있어 CSS 선택자보다 안정적.
    """
    url = DETAIL_URL.format(perf_id=perf_id)
    detail_headers = {
        **HEADERS,
        "Referer": f"{BASE_URL}/New/Genre/GenreList.aspx",
        "Sec-Fetch-Site": "same-origin",
    }

    try:
        r = client.get(url, headers=detail_headers, timeout=15)
        r.raise_for_status()
    except httpx.HTTPError as e:
        print(f"  ⚠️  상세 요청 실패 (ID={perf_id}): {e}")
        return None

    soup = BeautifulSoup(r.text, "html.parser")

    # ── JSON-LD 파싱 (가장 안정적) ──
    ld_json: dict = {}
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "{}")
            if data.get("@type") == "Event":
                ld_json = data
                break
        except json.JSONDecodeError:
            continue

    if not ld_json:
        print(f"  ⚠️  JSON-LD 없음 (ID={perf_id})")
        return None

    title = ld_json.get("name", "").strip()
    if not title:
        return None

    # ── 장르 필터 (HidIdGenre) ──────────────────────
    # HidIdGenre: 15457=뮤지컬, 15458=연극 / 그 외는 수집 제외
    hid_genre = soup.select_one("#HidIdGenre")
    genre_id  = hid_genre["value"] if hid_genre else ""
    if genre_id not in TARGET_GENRE_IDS:
        genre_label = GENRE_ID_MAP.get(genre_id, f"알수없음({genre_id})")
        print(f"  ⏭  장르 제외: [{genre_label}] {title[:30]}")
        return None

    genre = GENRE_ID_MAP[genre_id]   # "뮤지컬" 또는 "연극"

    # ── 서울 지역 필터 (HidRegionName) ──────────────
    # HidRegionName: 서울 공연 → "서울 종로구 ..." 형태로 시작
    hid_region = soup.select_one("#HidRegionName")
    region_val = (hid_region["value"] if hid_region else "").strip()
    if region_val and not region_val.startswith("서울"):
        print(f"  ⏭  지역 제외: [{region_val[:12]}] {title[:30]}")
        return None

    # 날짜
    start_date = ld_json.get("startDate", "")
    end_date   = ld_json.get("endDate", start_date)

    # 장소
    location = ld_json.get("location", {})
    venue    = location.get("name", "")
    address  = region_val   # HidRegionName이 더 완전한 주소 정보

    # 이미지
    image_raw = ld_json.get("image", "")
    image_url = ("https:" + image_raw) if image_raw.startswith("//") else image_raw

    # 티켓 URL
    offer    = ld_json.get("offers", {})
    ticket_url = offer.get("url", url)

    # ── 러닝타임 추출 ────────────────────────────────
    desc = ld_json.get("description", "")
    runtime: int | None = None
    rm = re.search(r"관람시간\s*:\s*(.+?)(?:\s+장소|$)", desc)
    if rm:
        runtime = parse_runtime(rm.group(1))
    if runtime is None:
        for text in soup.find_all(string=re.compile(r"총\s*\d+분")):
            runtime = parse_runtime(text.strip())
            if runtime:
                break

    # ── 출연진 (JSON-LD performer) ──
    # performer.name 이 문자열이 아닌 리스트로 올 수 있어 평탄화 처리
    def _extract_names(obj) -> list[str]:
        if isinstance(obj, str):
            return [obj] if obj.strip() else []
        if isinstance(obj, list):
            names = []
            for item in obj:
                names.extend(_extract_names(item))
            return names
        if isinstance(obj, dict):
            return _extract_names(obj.get("name", ""))
        return []

    performer = ld_json.get("performer", {})
    cast = _extract_names(performer)

    return {
        "title":       title,
        "subtitle":    "",
        "genre":       genre,
        "venue":       venue,
        "address":     address,
        "startDate":   start_date,
        "endDate":     end_date,
        "runtime":     runtime,
        "synopsis":    "",
        "imageUrl":    image_url,
        "ticketUrl":   ticket_url,
        "tags":        [],
        "cast":        cast,
        "source":      "ticket.yes24.com",
        "sourceUrl":   url,
        "collectedAt": datetime.now().isoformat(),
        "status":      "pending",
    }


# ── 메인 ────────────────────────────────────────
def main(max_pages: int = 5, page_size: int = 20) -> None:
    all_shows: list[dict] = []
    seen_ids: set[str] = set()
    skipped_genre = 0
    skipped_region = 0

    print("🎭 예스24 공연 수집 시작")
    print("   수집 조건: 장르=뮤지컬+연극 / 지역=서울")
    print(f"   최대 {max_pages}페이지 × {page_size}건")

    with httpx.Client(follow_redirects=True, timeout=15) as client:
        # 1. 메인 방문 → 기본 쿠키 획득
        client.get(BASE_URL, headers=HEADERS)
        _delay()

        # 2. 목록 페이지 방문 → machine 토큰 + 세션 쿠키 획득
        machine = _get_machine_token(client)
        print(f"   machine 토큰: {machine}\n")
        _delay()

        for page in range(1, max_pages + 1):
            perf_ids, total = fetch_list(client, machine, page, page_size)
            if not perf_ids:
                print(f"\n데이터 없음. 수집 종료.")
                break

            for perf_id in perf_ids:
                if perf_id in seen_ids:
                    continue
                seen_ids.add(perf_id)

                print(f"  🔍 상세 수집: ID={perf_id}")
                show = fetch_detail(client, perf_id)

                if show:
                    all_shows.append(show)
                    print(f"     ✅ [{show['genre']}] {show['title']} ({show['startDate']} ~ {show['endDate']})")

                _delay()

            # 마지막 페이지 감지
            if len(perf_ids) < page_size:
                print(f"\n마지막 페이지({page}쪽) 도달. 수집 종료.")
                break

    print(f"\n──────────────────────────────")
    print(f"✅ 수집 완료: {len(all_shows)}개 저장")
    print(f"   (장르 제외: ⏭ 로그 참조 / 지역 제외: ⏭ 로그 참조)")
    print(f"──────────────────────────────")

    OUTPUT_FILE.write_text(
        json.dumps(all_shows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"→ {OUTPUT_FILE}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="예스24 티켓 공연 크롤러 (서울 뮤지컬+연극 전용)"
    )
    parser.add_argument("--pages", type=int, default=5,  help="최대 페이지 수 (기본 5)")
    parser.add_argument("--size",  type=int, default=20, help="페이지당 건수 (기본 20, 최대 100)")
    args = parser.parse_args()
    main(max_pages=args.pages, page_size=args.size)
