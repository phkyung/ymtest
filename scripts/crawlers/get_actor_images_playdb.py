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

" 등" 처리:
  actorName에 " 등"이 포함된 경우 → 제거 후 검색 및 저장 ("홍나현 등" → "홍나현")

--from-shows 모드:
  shows 컬렉션 cast[].actorName 수집 → actors 없는 배우 자동 등록 후 이미지 검색

사용법:
    python get_actor_images_playdb.py --key path/to/serviceAccountKey.json
    python get_actor_images_playdb.py --key key.json --name "김준현"
    python get_actor_images_playdb.py --key key.json --overwrite
    python get_actor_images_playdb.py --key key.json --from-shows --test
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
    배우 상세 페이지에서 출연작 (제목, 장르) 집합 추출.

    플레이DB 구조:
      - div.detail_contents : 실제 출연작 섹션 (여기만 파싱)
      - div.ranking         : 페이지 상단 검색 랭킹 (무시)
      - div#header 등       : 네비게이션/배너 (무시)

    출연작 표기: "뮤지컬 〈제목〉" 형식
    → 장르(뮤지컬/연극 등) + 제목을 함께 추출.
    장르 없는 경우 빈 문자열로 저장.
    """
    import re as _re
    GENRES = r"(뮤지컬|연극|오페라|콘서트|창극|무용|발레|쇼|음악극)"
    show_titles = set()

    # ── 출연작 섹션만 사용 (div.detail_contents) ──
    # 없으면 fallback: ranking/header 제거 후 전체 파싱
    section = soup.find("div", class_="detail_contents")
    if not section:
        # ranking, header 등 노이즈 태그 제거 후 전체 사용
        section = BeautifulSoup(str(soup), "html.parser")
        for noise in section.find_all(
            ["div", "header"],
            class_=lambda c: c and any(k in c for k in ["ranking", "gnb", "topmenu", "logo", "banner"]),
        ):
            noise.decompose()
        for noise in section.find_all(True, id=lambda i: i and any(
            k in i.lower() for k in ["header", "rank_layer", "servicelayer", "banner"]
        )):
            noise.decompose()

    # "장르 〈제목〉" 패턴 추출
    section_text = section.get_text()
    for m in _re.finditer(GENRES + r"?\s*[〈《](.+?)[〉》]", section_text):
        genre = (m.group(1) or "").strip()
        title = m.group(2).strip()
        if title and len(title) > 1:
            show_titles.add((title, genre))

    return show_titles


# ── 공연명 정규화 ([] 괄호·공백·특수문자 제거 + 소문자 변환) ──────────
def _normalize(text):
    """
    비교를 위한 정규화:
    1. [대학로] [명동] 등 [] 괄호 내용 제거
    2. 공백 전체 제거
    3. 특수문자 제거 (한글·영문·숫자만 유지)
    4. 소문자 변환
    """
    text = re.sub(r"\[.*?\]", "", text)   # [] 괄호 내용 제거
    text = re.sub(r"[^\w]", "", text)     # 공백·특수문자 제거 (한글/영문/숫자 유지)
    return text.lower()


# ── 출연작 겹침 확인 (유사도 + 장르 기반) ────────────────
def _titles_match(norm, our_norm, norm_genre="", our_norm_genre=""):
    """
    두 정규화 공연명 + 장르 비교.
    - 제목 비교:
        완전 일치: 항상 허용
        포함 관계: 양쪽 모두 6자 이상일 때만 허용
    - 장르 비교:
        둘 다 있으면 반드시 일치해야 함
        어느 한쪽이라도 없으면 제목만으로 판단
    """
    # 제목 조건
    title_ok = norm == our_norm or (
        len(norm) >= 6 and len(our_norm) >= 6
        and (norm in our_norm or our_norm in norm)
    )
    if not title_ok:
        return False
    # 장르 조건 (둘 다 있을 때만 검사)
    if norm_genre and our_norm_genre:
        return norm_genre == our_norm_genre
    return True


def has_show_overlap(actor_shows, our_shows_normalized):
    """
    플레이DB 배우 출연작과 우리 DB 공연명 유사도+장르 기반 매칭.
    actor_shows: set of (title, genre)
    our_shows_normalized: list of (norm_title, norm_genre)
    """
    for (title, genre) in actor_shows:
        norm      = _normalize(title)
        norm_genre = _normalize(genre)
        if not norm:
            continue
        for (our_norm, our_norm_genre) in our_shows_normalized:
            if not our_norm:
                continue
            if _titles_match(norm, our_norm, norm_genre, our_norm_genre):
                return True
    return False


def get_matched_titles(actor_shows, our_shows_normalized):
    """겹치는 공연명 리스트 반환 (로그 출력용)."""
    matched = []
    for (title, genre) in actor_shows:
        norm      = _normalize(title)
        norm_genre = _normalize(genre)
        if not norm:
            continue
        for (our_norm, our_norm_genre) in our_shows_normalized:
            if not our_norm:
                continue
            if _titles_match(norm, our_norm, norm_genre, our_norm_genre):
                matched.append(title)
                break
    return matched


# ── shows cast 배우 자동 등록 ─────────────────────
def load_and_register_cast_actors(db, actors_ref, limit_shows=None, limit_cast=None):
    """
    shows 컬렉션의 cast[].actorName을 수집하여 actors 컬렉션에 없는 배우를 자동 등록.
    반환값: 새로 등록된 actor 목록 [{"id": doc_id, "name": clean_name}]
    """
    # 기존 actors 이름 세트
    existing_names = {d.to_dict().get("name", "").strip() for d in actors_ref.stream()}

    # shows 로드
    shows_docs = list(db.collection("shows").stream())
    if limit_shows:
        shows_docs = shows_docs[:limit_shows]
    print(f"📺 shows {len(shows_docs)}개 스캔 중...")

    # cast actorName 수집 (중복 제거, actors에 없는 것만)
    cast_names = []
    seen = set()
    for doc in shows_docs:
        data = doc.to_dict()
        for member in data.get("cast", []):
            raw_name = member.get("actorName", "").strip()
            if not raw_name or raw_name in seen:
                continue
            seen.add(raw_name)
            # " 등" 제거 후 비교
            clean = re.sub(r"\s+등$", "", raw_name).strip()
            if clean not in existing_names:
                cast_names.append((raw_name, clean))

    if limit_cast:
        cast_names = cast_names[:limit_cast]

    print(f"   → actors 컬렉션에 없는 배우 {len(cast_names)}명 발견")

    # actors 문서 생성
    new_actors = []
    for raw_name, clean_name in cast_names:
        # 형식 이상 스킵 (" 등" 제거 후에도 이상한 경우)
        if re.search(r"[·,&]|\s+외$", clean_name):
            print(f"   ⏭️  {raw_name} 스킵 (이름 형식 이상)")
            continue
        doc_ref = actors_ref.document()
        doc_ref.set({
            "name": clean_name,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
        label = f"{raw_name} → {clean_name}" if raw_name != clean_name else clean_name
        print(f"   ➕ {label} (actors 등록, id={doc_ref.id})")
        new_actors.append({"id": doc_ref.id, "name": clean_name})

    return new_actors


# ── 메인 ────────────────────────────────────────
def main(
    key_path=None,
    target_name=None,
    overwrite=False,
    pending_out="pending_actor_images.json",
    from_shows=False,
    test=False,
    debug=False,
):
    db = init_firebase(key_path)

    print("🎭 플레이DB 배우 사진 스마트 수집 시작\n")

    # ── actors 컬렉션 전체 로드 ──
    actors_ref  = db.collection("actors")
    all_actors  = [{"id": d.id, **d.to_dict()} for d in actors_ref.stream()]

    # ── [2] shows cast 배우 자동 등록 ──
    if from_shows:
        limit_shows = 3 if test else None
        limit_cast  = 5 if test else None
        new_actors = load_and_register_cast_actors(
            db, actors_ref,
            limit_shows=limit_shows,
            limit_cast=limit_cast,
        )
        print(f"   → {len(new_actors)}명 새로 등록, 이미지 검색 진행\n")
        # 새로 등록된 배우만 이미지 검색 대상으로
        all_actors = new_actors

    # ── shows + pending 공연명 + 장르 수집 (출연작 매칭용) ──
    print("📋 shows / pending 공연명 로드 중...")
    our_shows_normalized = []   # list of (norm_title, norm_genre)
    for col_name in ("shows", "pending"):
        for d in db.collection(col_name).stream():
            data  = d.to_dict()
            title = data.get("title", "").strip()
            genre = data.get("genre", "").strip()
            if title:
                our_shows_normalized.append((_normalize(title), _normalize(genre)))
    print(f"   → 총 {len(our_shows_normalized)}개 공연명 로드됨\n")

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

            # ── [1] " 등" 제거 처리 ("홍나현 등" → "홍나현") ──
            search_name  = actor_name
            name_cleaned = False
            if re.search(r"\s+등$", actor_name):
                search_name  = re.sub(r"\s+등$", "", actor_name).strip()
                name_cleaned = True

            # ── 이름 형식 이상 체크: "홍·이" / "A, B" / " 외" 등 ──
            if re.search(r"[·,&]|\s+외$", search_name):
                print(f"[{idx}/{total}] {actor_name} ❌ 스킵 (이름 형식 이상)")
                skipped += 1
                continue

            if name_cleaned:
                print(f"[{idx}/{total}] {actor_name} → {search_name}", end=" ", flush=True)
            else:
                print(f"[{idx}/{total}] {actor_name}", end=" ", flush=True)

            # ── 플레이DB 검색 ──
            results = search_playdb_actors(search_name, client)
            time.sleep(REQUEST_DELAY)

            # ── 검색 결과 없음 → 스킵 ──
            if not results:
                print("❌ 스킵 (검색 결과 없음)")
                skipped += 1
                continue

            # ── 이름 완전 일치 결과만 추출 ──
            exact_matches = [r for r in results if r["name"] == search_name]

            # ── 이름 부분 일치만 있음 → 검토 대기 ──
            if not exact_matches:
                found_names = [r["name"] for r in results[:3]]
                print(f"⚠️  검토대기 (이름 부분 일치: {found_names})")
                if actor_id not in pending_actor_ids:
                    pending_list.append({
                        "actorId":    actor_id,
                        "actorName":  search_name,
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
                        "actorName":  search_name,
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

            # ── [DEBUG] 플레이DB 출연작 목록 + 매칭 상세 출력 ──
            if debug:
                if actor_shows:
                    print(f"\n  [DEBUG] 플레이DB 출연작 원본 ({len(actor_shows)}개):")
                    for title, genre in sorted(actor_shows):
                        print(f"    [{genre or '장르없음'}] {title}")
                else:
                    print("\n  [DEBUG] 플레이DB 출연작 없음")

                print(f"  [DEBUG] 매칭 결과:")
                for title, genre in sorted(actor_shows):
                    norm = _normalize(title)
                    norm_genre = _normalize(genre)
                    if not norm:
                        continue
                    for our_norm, our_norm_genre in our_shows_normalized:
                        if not our_norm:
                            continue
                        if _titles_match(norm, our_norm, norm_genre, our_norm_genre):
                            print(f"    ✅ '{title}'({genre or '장르없음'}) ↔ our='{our_norm}'({our_norm_genre or '장르없음'})")

            if has_show_overlap(actor_shows, our_shows_normalized):
                # ── ✅ 자동 저장 조건 충족: 이름 일치 + 출연작 겹침 ──
                matched_titles = get_matched_titles(actor_shows, our_shows_normalized)
                print(f"✅ 자동저장 (출연작 매칭: {matched_titles[0] if matched_titles else '?'})")
                try:
                    update_data = {"imageUrl": match["image_url"]}
                    # " 등" 제거한 경우 name 필드도 정리된 이름으로 업데이트
                    if name_cleaned:
                        update_data["name"] = search_name
                    actors_ref.document(actor_id).update(update_data)
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
                        "actorName":  search_name,
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
    parser.add_argument(
        "--from-shows", action="store_true",
        help="shows 컬렉션 cast 배우 중 actors에 없는 배우를 자동 등록 후 이미지 검색",
    )
    parser.add_argument(
        "--test", action="store_true",
        help="--from-shows 테스트 모드: shows 3개, cast 배우 5명만 처리",
    )
    parser.add_argument(
        "--debug", action="store_true",
        help="플레이DB 출연작 원본 및 매칭 결과 상세 출력",
    )
    args = parser.parse_args()
    main(
        key_path=args.key,
        target_name=args.name,
        overwrite=args.overwrite,
        pending_out=args.pending_out,
        from_shows=args.from_shows,
        test=args.test,
        debug=args.debug,
    )
