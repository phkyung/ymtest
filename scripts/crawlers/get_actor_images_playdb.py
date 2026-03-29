"""
get_actor_images_playdb.py — 플레이DB에서 배우 사진 스마트 자동/검토 수집
────────────────────────────────────────────────────────────────────────────

스마트 분류 로직:
  ✅ 자동 저장:  이름 완전 일치 + shows/pending 공연명 1개 이상 겹침
                → Firestore actors 컬렉션 imageUrl 즉시 업데이트
  ⚠️ 검토 대기: 이름 같지만 출연작 없음 / 동명이인 여러 명 / 이름 부분 일치
                → pending_actor_images.json 파일 저장
                → Firestore pending_actors 컬렉션 저장 (관리자 UI용)
  ❌ 스킵:      검색 결과 없음 / 이름 형식 이상

진행 출력 예시:
  [1/1497] 조규현 ✅ 자동저장 (출연작 매칭: 데스노트)
  [2/1497] 김민석 ⚠️ 검토대기 (동명이인 3명)
  [3/1497] 이정환 등 ❌ 스킵 (이름 형식 이상)

사용법:
    python get_actor_images_playdb.py --key path/to/serviceAccountKey.json
    python get_actor_images_playdb.py --key key.json --name "김준현"
    python get_actor_images_playdb.py --key key.json --overwrite
    python get_actor_images_playdb.py --key key.json --pending-out ./pending_actor_images.json
"""

import argparse
import json
import os
import re
import sys
import time
import tempfile

import httpx
from bs4 import BeautifulSoup
import firebase_admin
from firebase_admin import credentials, firestore

# ── 플레이DB URL 상수 ─────────────────────────────
PLAYDB_SEARCH_URL = "http://www.playdb.co.kr/search/Search.asp"
PLAYDB_DETAIL_URL = "http://www.playdb.co.kr/artistdb/detail.asp"
PLAYDB_BASE_URL   = "http://www.playdb.co.kr"

# 요청 간 딜레이 (서버 부하 방지, 초 단위)
REQUEST_DELAY = 1.5

# HTTP 헤더 (봇 차단 우회용 브라우저 흉내)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer":         "http://www.playdb.co.kr/",
    "Accept-Encoding": "identity",
}


# ── Firebase 초기화 ──────────────────────────────
def init_firebase(key_path=None):
    """Firebase Admin SDK 초기화 후 Firestore 클라이언트 반환."""
    if firebase_admin._apps:
        return firestore.client()

    if key_path:
        cred = credentials.Certificate(key_path)
    else:
        json_str = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        if not json_str:
            print("❌ Firebase 인증 정보가 없습니다.")
            print("   --key 옵션 또는 FIREBASE_SERVICE_ACCOUNT_JSON 환경변수를 설정하세요.")
            sys.exit(1)
        # 환경변수 JSON을 임시 파일로 저장 후 인증
        tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        tmp.write(json_str)
        tmp.close()
        cred = credentials.Certificate(tmp.name)
        os.unlink(tmp.name)

    firebase_admin.initialize_app(cred)
    return firestore.client()


# ── 플레이DB 배우 검색 ────────────────────────────
def search_playdb_actors(name, client):
    """
    플레이DB 배우 검색 결과 파싱.
    반환값: [{ name, image_url, profile_url, actor_id }]
    결과 없거나 오류 시 빈 리스트 반환.
    """
    try:
        import urllib.parse
        _q = urllib.parse.quote(name.encode("euc-kr"))
        r = client.get(
            f"{PLAYDB_SEARCH_URL}?KindCode=&Query={_q}",
            params=None,
            headers=HEADERS,
            timeout=15,
        )
        r.raise_for_status()
        # 플레이DB는 EUC-KR 인코딩 사용
        html = r.content.decode("euc-kr", errors="replace")
        soup = BeautifulSoup(html, "html.parser")
        return _parse_actor_list(soup)
    except httpx.HTTPStatusError as e:
        print(f"  ⚠️  검색 HTTP 오류 ({name}): {e.response.status_code}")
    except Exception as e:
        print(f"  ⚠️  검색 실패 ({name}): {e}")
    return []


def _parse_actor_list(soup):
    """플레이DB 검색 결과 파싱 - b태그 안 배우 링크만 추출"""
    import re
    results = []
    seen_ids = set()

    # <b> 태그 안의 ManNo 링크 = 실제 검색결과 배우
    for b_tag in soup.find_all("b"):
        link = b_tag.find("a", href=True)
        if not link:
            # b 태그의 부모가 링크인 경우
            parent = b_tag.parent
            if parent and parent.name == "a":
                link = parent
        if not link:
            continue
        href = link.get("href", "")
        if "ManNo=" not in href:
            continue
        m = re.search(r"ManNo=(\d+)", href)
        if not m:
            continue
        actor_id = m.group(1)
        if actor_id in seen_ids:
            continue
        seen_ids.add(actor_id)
        name_text = b_tag.get_text(strip=True)
        if not name_text or len(name_text) > 20:
            continue
        profile_url = href if href.startswith("http") else "http://www.playdb.co.kr" + href
        # 사진: 같은 ManNo를 가진 a 태그 중 img 포함한 것
        img_url = ""
        for img_link in soup.find_all("a", href=re.compile(r"ManNo=" + actor_id)):
            img = img_link.find("img")
            if img:
                src = img.get("src", "")
                if src and "btn" not in src and "noimg" not in src:
                    img_url = src
                    if img_url.startswith("//"):
                        img_url = "https:" + img_url
                    elif img_url.startswith("/"):
                        img_url = "http://www.playdb.co.kr" + img_url
                    break
        results.append({
            "name": name_text,
            "image_url": img_url,
            "profile_url": profile_url,
            "actor_id": actor_id,
        })
    return results

def fetch_actor_shows(actor_id, client):
    """
    플레이DB 배우 상세 페이지에서 출연 공연명 집합 반환.
    오류 시 빈 집합 반환.
    """
    try:
        r = client.get(
            PLAYDB_DETAIL_URL,
            params={"ManNo": actor_id},
            headers=HEADERS,
            timeout=15,
        )
        r.raise_for_status()
        html = r.content.decode("euc-kr", errors="replace")
        soup = BeautifulSoup(html, "html.parser")
        return _parse_actor_shows(soup)
    except Exception as e:
        print(f"    ⚠️  상세 페이지 오류 (manid={actor_id}): {e}")
    return set()


def _parse_actor_shows(soup):
    """
    배우 상세 페이지에서 출연작 제목 집합 추출.

    플레이DB 출연작 구조 (대략):
      <table class="list_table">
        <tr>
          <td class="title"><a href="/show/...">데스노트</a></td>
          ...
        </tr>
      </table>
    또는 showdetail.asp 링크에서 직접 추출.
    """
    show_titles = set()

    # 출연작 테이블에서 제목 셀 파싱
    for row in soup.select("table.list_table tr, .work_list tr, .show_list tr"):
        # 제목 셀: td.title 또는 2번째 td
        title_cell = row.select_one("td.title, td.name, td:nth-child(2)")
        if title_cell:
            title = title_cell.get_text(strip=True)
            if title and len(title) > 1:
                show_titles.add(title)

    # showdetail 링크 텍스트에서도 추출 (대안)
    for a in soup.select("a[href*='showdetail'], a[href*='PlayCd='], a[href*='showId=']"):
        title = a.get_text(strip=True)
        if title and len(title) > 1:
            show_titles.add(title)

    return show_titles


# ── 공연명 정규화 (공백·대소문자 무시 비교) ──────────
def _normalize(text):
    """비교를 위해 공백 제거 + 소문자 변환."""
    return re.sub(r"\s+", "", text).lower()


# ── 출연작 겹침 확인 ───────────────────────────────
def has_show_overlap(actor_shows, our_shows_normalized):
    """
    플레이DB 배우의 출연작과 우리 DB 공연명이 1개 이상 겹치는지 확인.
    정규화된 집합으로 비교.
    """
    normalized = {_normalize(t) for t in actor_shows}
    return bool(normalized & our_shows_normalized)


def get_matched_titles(actor_shows, our_shows_normalized):
    """겹치는 공연명 리스트 반환 (로그 출력용)."""
    return [t for t in actor_shows if _normalize(t) in our_shows_normalized]


# ── 메인 ────────────────────────────────────────
def main(
    key_path=None,
    target_name=None,
    overwrite=False,
    pending_out="pending_actor_images.json",
):
    db = init_firebase(key_path)

    print("🎭 플레이DB 배우 사진 스마트 수집 시작\n")

    # ── actors 컬렉션 전체 로드 ──
    actors_ref  = db.collection("actors")
    all_actors  = [{"id": d.id, **d.to_dict()} for d in actors_ref.stream()]

    # ── shows + pending 공연명 수집 (출연작 매칭용) ──
    print("📋 shows / pending 공연명 로드 중...")
    our_show_titles = set()
    for col_name in ("shows", "pending"):
        for d in db.collection(col_name).stream():
            title = d.to_dict().get("title", "").strip()
            if title:
                our_show_titles.add(title)
    # 정규화된 집합 캐싱
    our_shows_normalized = {_normalize(t) for t in our_show_titles}
    print(f"   → 총 {len(our_show_titles)}개 공연명 로드됨\n")

    # ── 처리 대상 필터링 ──
    if target_name:
        # 특정 배우만 처리
        targets = [a for a in all_actors if a.get("name", "").strip() == target_name]
    elif overwrite:
        # 이미지 있어도 전체 처리
        targets = all_actors
    else:
        # imageUrl이 비어있는 배우만 처리 (기본)
        targets = [a for a in all_actors if not a.get("imageUrl", "").strip()]

    total = len(targets)
    print(f"🔍 처리 대상: {total}명 (전체 {len(all_actors)}명 중)\n")

    if not targets:
        print("처리할 배우가 없습니다.")
        return

    # ── 기존 검토 대기 파일 로드 (이어붙이기 위해) ──
    pending_list = []
    if os.path.exists(pending_out):
        try:
            with open(pending_out, encoding="utf-8") as f:
                pending_list = json.load(f)
        except Exception:
            pending_list = []

    # 이미 pending에 있는 배우 ID 세트 (중복 방지)
    pending_actor_ids = {p.get("actorId") for p in pending_list}

    auto_saved    = 0
    pending_added = 0
    skipped       = 0

    with httpx.Client(follow_redirects=True) as client:
        for idx, actor in enumerate(targets, 1):
            actor_id   = actor["id"]
            actor_name = actor.get("name", "").strip()

            # ── 이름 없는 배우 스킵 ──
            if not actor_name:
                print(f"[{idx}/{total}] (이름 없음) ❌ 스킵")
                skipped += 1
                continue

            # ── 이름 형식 이상 체크: "홍길동 등" / "홍·이" / "A, B" 등 ──
            if re.search(r"[·,&]|\s+등$|\s+외$", actor_name):
                print(f"[{idx}/{total}] {actor_name} ❌ 스킵 (이름 형식 이상)")
                skipped += 1
                continue

            print(f"[{idx}/{total}] {actor_name}", end=" ", flush=True)

            # ── 플레이DB 검색 ──
            results = search_playdb_actors(actor_name, client)
            time.sleep(REQUEST_DELAY)

            # ── 검색 결과 없음 → 스킵 ──
            if not results:
                print("❌ 스킵 (검색 결과 없음)")
                skipped += 1
                continue

            # ── 이름 완전 일치 결과만 추출 ──
            exact_matches = [r for r in results if r["name"] == actor_name]

            # ── 이름 부분 일치만 있음 → 검토 대기 ──
            if not exact_matches:
                found_names = [r["name"] for r in results[:3]]
                print(f"⚠️  검토대기 (이름 부분 일치: {found_names})")
                if actor_id not in pending_actor_ids:
                    pending_list.append({
                        "actorId":    actor_id,
                        "actorName":  actor_name,
                        "imageUrl":   results[0]["image_url"],
                        "profileUrl": results[0]["profile_url"],
                        "reason":     f"이름 부분 일치 ({results[0]['name']})",
                        "candidates": [
                            {
                                "name":       r["name"],
                                "imageUrl":   r["image_url"],
                                "profileUrl": r["profile_url"],
                            }
                            for r in results[:5]
                        ],
                    })
                    pending_actor_ids.add(actor_id)
                    pending_added += 1
                continue

            # ── 동명이인 여러 명 → 검토 대기 ──
            if len(exact_matches) > 1:
                print(f"⚠️  검토대기 (동명이인 {len(exact_matches)}명)")
                if actor_id not in pending_actor_ids:
                    pending_list.append({
                        "actorId":    actor_id,
                        "actorName":  actor_name,
                        "imageUrl":   exact_matches[0]["image_url"],
                        "profileUrl": exact_matches[0]["profile_url"],
                        "reason":     f"동명이인 {len(exact_matches)}명",
                        "candidates": [
                            {
                                "name":       r["name"],
                                "imageUrl":   r["image_url"],
                                "profileUrl": r["profile_url"],
                            }
                            for r in exact_matches[:5]
                        ],
                    })
                    pending_actor_ids.add(actor_id)
                    pending_added += 1
                continue

            # ── 이름 완전 일치 1명 → 배우 상세 페이지에서 출연작 확인 ──
            match = exact_matches[0]
            actor_shows = fetch_actor_shows(match["actor_id"], client)
            time.sleep(REQUEST_DELAY)

            if has_show_overlap(actor_shows, our_shows_normalized):
                # ── ✅ 자동 저장 조건 충족: 이름 일치 + 출연작 겹침 ──
                matched_titles = get_matched_titles(actor_shows, our_shows_normalized)
                print(f"✅ 자동저장 (출연작 매칭: {matched_titles[0] if matched_titles else '?'})")
                try:
                    actors_ref.document(actor_id).update({"imageUrl": match["image_url"]})
                    auto_saved += 1
                except Exception as e:
                    print(f"   ❌ Firestore 업데이트 실패: {e}")
                    skipped += 1
            else:
                # ── ⚠️ 이름 일치하지만 출연작 미매칭 → 검토 대기 ──
                print("⚠️  검토대기 (출연작 미매칭)")
                if actor_id not in pending_actor_ids:
                    pending_list.append({
                        "actorId":    actor_id,
                        "actorName":  actor_name,
                        "imageUrl":   match["image_url"],
                        "profileUrl": match["profile_url"],
                        "reason":     "출연작 미매칭",
                        "candidates": [
                            {
                                "name":       match["name"],
                                "imageUrl":   match["image_url"],
                                "profileUrl": match["profile_url"],
                            }
                        ],
                    })
                    pending_actor_ids.add(actor_id)
                    pending_added += 1

    # ── 검토 대기 JSON 파일 저장 ──
    if pending_added > 0 or os.path.exists(pending_out):
        with open(pending_out, "w", encoding="utf-8") as f:
            json.dump(pending_list, f, ensure_ascii=False, indent=2)
        print(f"\n📄 검토 대기 파일 저장: {pending_out} (총 {len(pending_list)}건)")

    # ── Firestore pending_actors 컬렉션 동기화 ──
    # AdminPage.jsx 배우 관리 > 사진 검토 탭에서 이 컬렉션을 읽어 표시함
    if pending_added > 0:
        print("☁️  Firestore pending_actors 컬렉션 동기화 중...")
        batch   = db.batch()
        cnt     = 0
        for item in pending_list:
            if not item.get("actorId"):
                continue
            ref = db.collection("pending_actors").document(item["actorId"])
            batch.set(ref, item, merge=True)
            cnt += 1
            # Firestore 배치 최대 500개 제한 → 400개마다 커밋
            if cnt % 400 == 0:
                batch.commit()
                batch = db.batch()
        if cnt % 400 != 0:
            batch.commit()
        print(f"   → {cnt}개 저장 완료")

    print(f"""
──────────────────────────────────────
플레이DB 배우 사진 수집 완료
  ✅ 자동 저장:   {auto_saved}명
  ⚠️  검토 대기:  {pending_added}명
  ❌ 스킵:        {skipped}명
──────────────────────────────────────
""")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="플레이DB 배우 사진 스마트 자동/검토 수집"
    )
    parser.add_argument(
        "--key", metavar="PATH",
        help="Firebase 서비스 계정 JSON 키 파일 경로",
    )
    parser.add_argument(
        "--name", metavar="NAME",
        help="특정 배우 이름만 처리 (생략 시 imageUrl 없는 전체 배우)",
    )
    parser.add_argument(
        "--overwrite", action="store_true",
        help="이미지가 있는 배우도 처리 (덮어씀)",
    )
    parser.add_argument(
        "--pending-out", metavar="FILE",
        default="pending_actor_images.json",
        help="검토 대기 목록 저장 파일 경로 (기본값: pending_actor_images.json)",
    )
    args = parser.parse_args()
    main(
        key_path=args.key,
        target_name=args.name,
        overwrite=args.overwrite,
        pending_out=args.pending_out,
    )
