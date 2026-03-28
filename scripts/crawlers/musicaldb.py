"""
musicaldb.py — musicaldb.com 서울 공연 수집 크롤러
─────────────────────────────────────────────────
사용법:
    python musicaldb.py              # 기본 실행 (최대 5페이지)
    python musicaldb.py --pages 10   # 최대 10페이지까지 수집

출력:
    pending_shows.json — 수집된 공연 목록 (upload.py로 Firestore에 업로드)

주의:
    - 실행 전에 musicaldb.com에 접속해 실제 HTML 구조를 확인하세요.
    - CSS 선택자(SELECTOR_*)가 사이트 변경 시 깨질 수 있습니다.
    - robots.txt 준수: https://www.musicaldb.com/robots.txt 확인 권장
"""

import argparse
import json
import random
import re
import time
from datetime import datetime
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

# ── 설정 ────────────────────────────────────────
BASE_URL    = "https://www.musicaldb.com"
LIST_URL    = f"{BASE_URL}/perf/list?area=11&page={{page}}"  # area=11: 서울
OUTPUT_FILE = Path(__file__).parent / "pending_shows.json"

# 요청 간 대기 시간 범위 (초) — 봇 감지 우회용 랜덤 딜레이
REQUEST_DELAY_MIN = 3.0
REQUEST_DELAY_MAX = 4.5

# Chrome 124 실제 브라우저에서 복사한 헤더 (DevTools → Network → copy as fetch)
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

# ── CSS 선택자 (사이트 구조 변경 시 여기만 수정) ──────
# ⚠️ 아래 선택자는 musicaldb.com 실제 HTML을 보고 맞게 수정하세요.
SEL_LIST_ITEM   = "ul.perf-list li"           # 목록 페이지: 공연 카드 하나
SEL_ITEM_LINK   = "a"                         # 카드 내 상세 링크
SEL_ITEM_TITLE  = ".perf-title, h3.title"     # 카드 내 제목
SEL_ITEM_GENRE  = ".perf-genre, .genre-tag"   # 카드 내 장르

SEL_DETAIL_TITLE    = "h1.perf-name, .detail-title h2"
SEL_DETAIL_GENRE    = ".perf-info .genre, .info-genre"
SEL_DETAIL_VENUE    = ".perf-info .venue, .info-venue"
SEL_DETAIL_DATE     = ".perf-info .date, .info-date"
SEL_DETAIL_RUNTIME  = ".perf-info .runtime, .info-runtime"
SEL_DETAIL_SYNOPSIS = ".perf-synopsis p, .synopsis-text"
SEL_DETAIL_IMAGE    = "img.perf-poster, .poster-wrap img"
SEL_DETAIL_TICKET   = "a.btn-ticket, a.ticket-link"

SEL_NEXT_PAGE = "a.next, .pager a[rel='next']"


def _random_delay() -> None:
    """봇 감지 우회용 랜덤 딜레이"""
    time.sleep(random.uniform(REQUEST_DELAY_MIN, REQUEST_DELAY_MAX))


# ── 날짜 파싱 헬퍼 ──────────────────────────────
def parse_date_range(text: str) -> tuple[str, str]:
    """
    "2025.06.10 ~ 2025.09.28" 또는 "2025-06-10~2025-09-28" 형태를
    ("2025-06-10", "2025-09-28") 으로 변환
    """
    text = text.strip()
    dates = re.findall(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", text)
    if len(dates) >= 2:
        start = f"{dates[0][0]}-{dates[0][1].zfill(2)}-{dates[0][2].zfill(2)}"
        end   = f"{dates[1][0]}-{dates[1][1].zfill(2)}-{dates[1][2].zfill(2)}"
        return start, end
    if len(dates) == 1:
        d = f"{dates[0][0]}-{dates[0][1].zfill(2)}-{dates[0][2].zfill(2)}"
        return d, d
    return "", ""


def parse_runtime(text: str) -> int | None:
    """
    "총 120분 (인터미션 포함)" → 120
    "2시간 30분" → 150
    """
    text = text.strip()
    m = re.search(r"(\d+)\s*분", text)
    if m:
        return int(m.group(1))
    h = re.search(r"(\d+)\s*시간", text)
    mi = re.search(r"(\d+)\s*분", text)
    if h:
        total = int(h.group(1)) * 60
        total += int(mi.group(1)) if mi else 0
        return total
    return None


def clean_text(tag) -> str:
    """BeautifulSoup 태그에서 공백 정리된 텍스트 반환"""
    if tag is None:
        return ""
    return tag.get_text(separator=" ", strip=True)


# ── 상세 페이지 파싱 ────────────────────────────
def fetch_detail(client: httpx.Client, url: str) -> dict | None:
    """
    공연 상세 페이지 URL을 받아 공연 정보 딕셔너리를 반환.
    파싱 실패 시 None 반환.
    """
    try:
        resp = client.get(url, headers={**HEADERS, "Referer": BASE_URL + "/perf/list"})
        resp.raise_for_status()
    except httpx.HTTPError as e:
        print(f"  ⚠️  상세 페이지 요청 실패: {url} — {e}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    # 제목
    title_tag = soup.select_one(SEL_DETAIL_TITLE)
    title = clean_text(title_tag)
    if not title:
        print(f"  ⚠️  제목을 찾지 못했습니다: {url}")
        return None

    # 장르
    genre_tag = soup.select_one(SEL_DETAIL_GENRE)
    genre_raw = clean_text(genre_tag)
    genre_map = {"뮤지컬": "뮤지컬", "musical": "뮤지컬",
                 "연극": "연극", "play": "연극",
                 "오페라": "오페라", "opera": "오페라",
                 "콘서트": "콘서트", "concert": "콘서트"}
    genre = next((v for k, v in genre_map.items() if k in genre_raw.lower()), "기타")

    # 공연장
    venue_tag = soup.select_one(SEL_DETAIL_VENUE)
    venue = clean_text(venue_tag)

    # 기간
    date_tag = soup.select_one(SEL_DETAIL_DATE)
    date_text = clean_text(date_tag)
    start_date, end_date = parse_date_range(date_text)

    # 러닝타임
    runtime_tag = soup.select_one(SEL_DETAIL_RUNTIME)
    runtime = parse_runtime(clean_text(runtime_tag)) if runtime_tag else None

    # 시놉시스
    synopsis_parts = soup.select(SEL_DETAIL_SYNOPSIS)
    synopsis = " ".join(clean_text(p) for p in synopsis_parts).strip()

    # 포스터 이미지
    img_tag = soup.select_one(SEL_DETAIL_IMAGE)
    image_url = ""
    if img_tag:
        src = img_tag.get("src") or img_tag.get("data-src", "")
        image_url = src if src.startswith("http") else BASE_URL + src

    # 티켓 링크
    ticket_tag = soup.select_one(SEL_DETAIL_TICKET)
    ticket_url = ticket_tag.get("href", "") if ticket_tag else ""

    return {
        "title":       title,
        "subtitle":    "",
        "genre":       genre,
        "venue":       venue,
        "address":     "",
        "startDate":   start_date,
        "endDate":     end_date,
        "runtime":     runtime,
        "synopsis":    synopsis,
        "imageUrl":    image_url,
        "ticketUrl":   ticket_url,
        "tags":        [],
        "cast":        [],
        "source":      "musicaldb.com",
        "sourceUrl":   url,
        "collectedAt": datetime.now().isoformat(),
        "status":      "pending",
    }


# ── 목록 페이지 파싱 ─────────────────────────────
def fetch_list_page(client: httpx.Client, page: int) -> tuple[list[str], bool]:
    """
    목록 페이지 1장을 파싱해 상세 URL 목록 반환.
    (detail_urls, 다음페이지_존재여부)
    """
    url = LIST_URL.format(page=page)
    print(f"\n📄 목록 페이지 {page} 수집 중: {url}")

    try:
        resp = client.get(url, headers={**HEADERS, "Referer": BASE_URL})
        resp.raise_for_status()
    except httpx.HTTPError as e:
        print(f"  ⚠️  목록 페이지 요청 실패: {e}")
        return [], False

    soup = BeautifulSoup(resp.text, "html.parser")
    items = soup.select(SEL_LIST_ITEM)
    print(f"  → 카드 {len(items)}개 발견")

    urls = []
    for item in items:
        link = item.select_one(SEL_ITEM_LINK)
        if not link:
            continue
        href = link.get("href", "")
        full_url = href if href.startswith("http") else BASE_URL + href
        if full_url not in urls:
            urls.append(full_url)

    has_next = bool(soup.select_one(SEL_NEXT_PAGE))
    return urls, has_next


# ── 메인 ────────────────────────────────────────
def main(max_pages: int = 5) -> None:
    all_shows = []
    seen_urls: set[str] = set()

    print(f"🎭 musicaldb.com 서울 공연 수집 시작 (최대 {max_pages}페이지)")

    # HTTP/2 지원 + 연결 재사용
    with httpx.Client(http2=True, follow_redirects=True, timeout=15) as client:
        for page in range(1, max_pages + 1):
            detail_urls, has_next = fetch_list_page(client, page)

            for detail_url in detail_urls:
                if detail_url in seen_urls:
                    continue
                seen_urls.add(detail_url)

                print(f"  🔍 상세 수집: {detail_url}")
                show = fetch_detail(client, detail_url)

                if show:
                    all_shows.append(show)
                    print(f"     ✅ [{show['genre']}] {show['title']} ({show['startDate']} ~ {show['endDate']})")

                _random_delay()

            if not has_next:
                print(f"\n마지막 페이지({page}쪽) 도달. 수집 종료.")
                break

            _random_delay()

    OUTPUT_FILE.write_text(
        json.dumps(all_shows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n✅ 수집 완료: 총 {len(all_shows)}개 공연 → {OUTPUT_FILE}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="musicaldb.com 서울 공연 크롤러")
    parser.add_argument("--pages", type=int, default=5, help="수집할 최대 페이지 수 (기본 5)")
    args = parser.parse_args()
    main(max_pages=args.pages)
