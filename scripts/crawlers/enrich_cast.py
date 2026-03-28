"""
enrich_cast.py — Firestore pending 컬렉션 캐스트 일괄 보강
──────────────────────────────────────────────────────────
목적:
  pending 컬렉션에 이미 있는 공연들에 KOPIS 공연상세 API로
  캐스트·포스터·티켓링크·시놉시스를 일괄 업데이트하고,
  배우 정보를 actors 컬렉션에 자동 등록한다.

동작 순서:
  1. Firestore pending 컬렉션 전체 조회
  2. 각 문서의 id 필드(PF로 시작하는 KOPIS ID)로 공연상세 API 호출
  3. 응답에서 prfcast / poster / relates / sty 추출
  4. pending 문서 업데이트
  5. actors 컬렉션에 없는 배우만 신규 등록

사용법:
    python enrich_cast.py --key service-account.json --kopis KOPIS_KEY
    python enrich_cast.py --key service-account.json --kopis KOPIS_KEY --dry-run
    python enrich_cast.py --key service-account.json --kopis KOPIS_KEY --limit 10

옵션:
    --key        Firebase 서비스 계정 JSON 파일 경로 (기본: service-account.json)
    --kopis      KOPIS API 서비스 키 (기본: 환경변수 KOPIS_API_KEY)
    --dry-run    실제 업데이트 없이 변경 내용만 출력
    --limit N    처리할 공연 수 제한 (테스트용)
    --skip-cast  캐스트 업데이트 건너뜀 (포스터/티켓만)
    --delay      요청 간 대기 시간(초, 기본 0.3)
"""

import argparse
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import httpx
import firebase_admin
from firebase_admin import credentials, firestore

# ── 설정 ────────────────────────────────────────────────
API_BASE      = "http://kopis.or.kr/openApi/restful"
REQUEST_DELAY = 0.3  # KOPIS 서버 부하 방지용 대기 시간(초)

# 기본 서비스 계정 파일 경로 (스크립트와 같은 디렉터리)
DEFAULT_KEY = Path(__file__).parent / "service-account.json"


# ── Firebase 초기화 ──────────────────────────────────────
def init_firebase(key_path: str) -> firestore.Client:
    """서비스 계정 JSON으로 Firebase Admin SDK 초기화 후 Firestore 클라이언트 반환."""
    if firebase_admin._apps:
        return firestore.client()
    cred = credentials.Certificate(key_path)
    firebase_admin.initialize_app(cred)
    return firestore.client()


# ── XML 헬퍼 ────────────────────────────────────────────
def _text(el: ET.Element | None, tag: str, default: str = "") -> str:
    """XML 요소에서 자식 태그의 텍스트 추출."""
    if el is None:
        return default
    child = el.find(tag)
    return (child.text or "").strip() if child is not None else default


# ── 캐스트 파싱 ─────────────────────────────────────────
def parse_cast(prfcast: str) -> list[dict]:
    """
    KOPIS prfcast 필드는 '홍길동, 이순신, 장보고' 형태의 쉼표 구분 문자열.
    → [{"actorName": "홍길동", "roleName": "", "isDouble": false}, ...]
    """
    if not prfcast.strip():
        return []
    # 쉼표·중국어쉼표·일본어쉼표·줄바꿈 모두 구분자로 처리
    raw_names = re.split(r"[,，、\n]+", prfcast)
    result = []
    seen = set()  # 같은 이름 중복 제거
    for name in raw_names:
        name = name.strip()
        # 공백만 있거나 빈 문자열, 괄호 내용만 있는 경우 건너뜀
        if not name or re.fullmatch(r"[\(\)（）\s]+", name):
            continue
        # "홍길동(역할명)" 형태 처리 — 역할명 분리
        role_match = re.match(r"(.+?)[（(](.+?)[）)]", name)
        if role_match:
            actor_name = role_match.group(1).strip()
            role_name  = role_match.group(2).strip()
        else:
            actor_name = name
            role_name  = ""
        if actor_name and actor_name not in seen:
            seen.add(actor_name)
            result.append({
                "actorName": actor_name,
                "roleName":  role_name,
                "isDouble":  False,
            })
    return result


# ── 티켓링크 파싱 ────────────────────────────────────────
def parse_ticket_links(relates_el: ET.Element | None) -> list[dict]:
    """
    <relates> 안의 <relate> 목록을 ticketLinks 배열로 변환.
    → [{"site": "인터파크", "url": "https://..."}]
    """
    if relates_el is None:
        return []
    links = []
    for rel in relates_el.findall("relate"):
        site = (rel.findtext("relatenm") or "").strip()
        url  = (rel.findtext("relateurl") or "").strip()
        if url:
            links.append({"site": site or "예매", "url": url})
    return links


# ── KOPIS 공연상세 API 호출 ──────────────────────────────
def fetch_detail(client: httpx.Client, kopis_id: str, api_key: str) -> ET.Element | None:
    """
    KOPIS 공연상세 API 호출.
    GET /pblprfr/{공연ID}?service={KEY}
    반환: XML 루트 요소 (dbs > db), 실패 시 None
    """
    url = f"{API_BASE}/pblprfr/{kopis_id}"
    try:
        resp = client.get(url, params={"service": api_key}, timeout=20)
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        # KOPIS 에러 응답 감지
        err = root.find(".//error")
        if err is not None:
            print(f"    ⚠️  KOPIS 오류: {ET.tostring(err, encoding='unicode').strip()}")
            return None
        # 공연 상세는 <dbs><db>...</db></dbs> 구조
        db_el = root.find("db")
        return db_el  # None이면 데이터 없음
    except httpx.HTTPError as e:
        print(f"    ⚠️  HTTP 오류: {e}")
        return None
    except ET.ParseError as e:
        print(f"    ⚠️  XML 파싱 오류: {e}")
        return None


# ── actors 컬렉션 캐시 로드 ──────────────────────────────
def load_existing_actors(db: firestore.Client) -> set[str]:
    """
    actors 컬렉션에서 이미 등록된 배우 이름 집합 반환.
    중복 등록 방지에 사용.
    """
    print("📋 기존 actors 컬렉션 조회 중...")
    docs = db.collection("actors").stream()
    names = {doc.to_dict().get("name", "") for doc in docs if doc.to_dict().get("name")}
    print(f"   → {len(names)}명 등록됨")
    return names


# ── 배우 등록 ────────────────────────────────────────────
def register_actors(
    db: firestore.Client,
    cast: list[dict],
    existing_names: set[str],
    dry_run: bool,
) -> int:
    """
    cast 배열에서 actors 컬렉션에 없는 배우만 신규 등록.
    반환: 신규 등록된 배우 수
    """
    added = 0
    actors_ref = db.collection("actors")
    for member in cast:
        name = member.get("actorName", "").strip()
        if not name or name in existing_names:
            continue
        existing_names.add(name)  # 중복 등록 방지 (이번 실행 내에서도)
        actor_data = {
            "name": name,
            "bio":  "",  # 자동 등록이므로 프로필은 비워둠
        }
        if not dry_run:
            # 배우 이름 기반 ID 생성 (한글 그대로 사용 가능하지만 공백 제거)
            actor_id = re.sub(r"\s+", "_", name)
            actors_ref.document(actor_id).set(actor_data, merge=True)
        added += 1
    return added


# ── pending 문서 한 건 처리 ──────────────────────────────
def enrich_one(
    doc_ref,
    doc_data: dict,
    client: httpx.Client,
    api_key: str,
    existing_actors: set[str],
    db: firestore.Client,
    dry_run: bool,
    skip_cast: bool,
    force_poster: bool = False,
) -> dict:
    """
    pending 문서 하나를 KOPIS API로 보강.
    반환: {"cast": int, "actors": int, "poster": bool, "poster_skipped": bool,
           "tickets": int, "synopsis": bool}
    결과 집계용.
    """
    result = {"cast": 0, "actors": 0, "poster": False, "poster_skipped": False,
              "tickets": 0, "synopsis": False}

    # kopis ID 추출:
    # upload.py가 id 필드를 "pending_" + md5 해시로 덮어쓰기 때문에
    # id 필드에는 PF ID가 없다. sourceUrl 쿼리스트링에서 파싱해야 한다.
    # 예) "http://...pblprfrView.do?pc=02&mt20id=PF288172" → "PF288172"
    source_url = doc_data.get("sourceUrl", "")
    m = re.search(r"mt20id=(PF\w+)", source_url, re.IGNORECASE)
    kopis_id = m.group(1) if m else ""

    # sourceUrl에 없는 경우 이미지 URL에서 시도
    # 예) "http://...pfmPoster/PF_PF288172_260327_133258.jpg" → "PF288172"
    if not kopis_id:
        img_url = doc_data.get("imageUrl", "")
        m2 = re.search(r"/(PF_)?(PF\d+)_", img_url, re.IGNORECASE)
        kopis_id = m2.group(2) if m2 else ""

    # PF로 시작하는 KOPIS 공연 ID가 아니면 건너뜀
    if not kopis_id.upper().startswith("PF"):
        return result

    # KOPIS 공연상세 API 호출
    db_el = fetch_detail(client, kopis_id, api_key)
    if db_el is None:
        return result

    update: dict = {}

    # ── 캐스트 ──────────────────────────────────────────
    if not skip_cast:
        prfcast_raw = _text(db_el, "prfcast")
        if prfcast_raw:
            cast = parse_cast(prfcast_raw)
            if cast:
                update["cast"] = cast
                result["cast"] = len(cast)
                # 배우 자동 등록
                result["actors"] = register_actors(db, cast, existing_actors, dry_run)

    # ── 포스터 이미지 ────────────────────────────────────
    # 기본: imageUrl이 비어있을 때만 업데이트
    # --force-poster: 기존 imageUrl 있어도 KOPIS 최신 URL로 덮어씀
    existing_image = doc_data.get("imageUrl", "")
    if not existing_image or force_poster:
        poster = _text(db_el, "poster")
        if poster:
            # force 모드에서도 이미 같은 URL이면 스킵
            if poster != existing_image:
                update["imageUrl"] = poster
                result["poster"] = True
            else:
                result["poster_skipped"] = True  # 같은 URL이므로 스킵
        # imageUrl이 없는데 KOPIS에도 poster 없으면 무시
    else:
        # 기존 imageUrl 있고 force 아님 → 스킵
        result["poster_skipped"] = True

    # ── 티켓 링크 (relates 배열 전체 저장) ─────────────
    relates_el = db_el.find("relates")
    ticket_links = parse_ticket_links(relates_el)
    if ticket_links:
        update["ticketLinks"] = ticket_links
        result["tickets"] = len(ticket_links)

    # ── 시놉시스 (기존 없을 때만) ───────────────────────
    if not doc_data.get("synopsis"):
        sty = _text(db_el, "sty")
        if sty:
            update["synopsis"] = sty
            result["synopsis"] = True

    # ── Firestore 업데이트 ───────────────────────────────
    if update and not dry_run:
        doc_ref.update(update)

    return result


# ── 메인 ────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="pending 컬렉션 공연에 KOPIS 캐스트 정보를 일괄 보강합니다."
    )
    parser.add_argument(
        "--key",
        default=str(DEFAULT_KEY),
        help="Firebase 서비스 계정 JSON 경로 (기본: service-account.json)",
    )
    parser.add_argument(
        "--kopis",
        default=os.environ.get("KOPIS_API_KEY", ""),
        help="KOPIS API 서비스 키 (기본: 환경변수 KOPIS_API_KEY)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="실제 업데이트 없이 변경 내용만 출력",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="처리할 공연 수 제한 (0 = 제한 없음)",
    )
    parser.add_argument(
        "--skip-cast",
        action="store_true",
        help="캐스트 업데이트 건너뜀 (포스터/티켓/시놉시스만 업데이트)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=REQUEST_DELAY,
        help=f"요청 간 대기 시간(초, 기본 {REQUEST_DELAY})",
    )
    parser.add_argument(
        "--force-poster",
        action="store_true",
        help="imageUrl이 이미 있어도 KOPIS 최신 포스터 URL로 덮어씀",
    )
    args = parser.parse_args()

    # ── 인증 정보 검증 ───────────────────────────────────
    if not args.kopis:
        print("❌ KOPIS API 키가 필요합니다.")
        print("   --kopis 옵션 또는 KOPIS_API_KEY 환경변수를 설정하세요.")
        sys.exit(1)

    if not Path(args.key).exists():
        print(f"❌ Firebase 서비스 계정 파일을 찾을 수 없습니다: {args.key}")
        sys.exit(1)

    if args.dry_run:
        print("🔍 [DRY-RUN 모드] 실제 업데이트 없이 변경 내용만 출력합니다.\n")
    if args.force_poster:
        print("🖼  [--force-poster] 기존 imageUrl 있어도 KOPIS 포스터로 덮어씁니다.\n")

    # ── Firebase / Firestore 초기화 ──────────────────────
    print("🔥 Firebase 초기화 중...")
    db = init_firebase(args.key)
    print("   → 연결 완료\n")

    # ── pending 컬렉션 전체 조회 ─────────────────────────
    print("📥 pending 컬렉션 조회 중...")
    pending_docs = list(db.collection("pending").stream())
    total = len(pending_docs)
    print(f"   → {total}건 조회됨\n")

    if total == 0:
        print("⚠️  pending 컬렉션이 비어 있습니다. 먼저 kopis.py + upload.py를 실행하세요.")
        sys.exit(0)

    # limit 적용
    if args.limit and args.limit < total:
        pending_docs = pending_docs[:args.limit]
        print(f"⚙️  --limit {args.limit} 적용: {args.limit}건만 처리합니다.\n")

    # ── actors 컬렉션 캐시 ───────────────────────────────
    existing_actors = load_existing_actors(db)
    print()

    # ── 집계 변수 ────────────────────────────────────────
    success         = 0  # 업데이트 성공
    skipped         = 0  # kopis ID 없거나 API 실패
    total_cast      = 0  # 추가된 캐스트 인원 합계
    total_actors    = 0  # 신규 등록 배우 합계
    total_tickets   = 0  # 티켓링크 추가 합계
    posters_added   = 0  # 포스터 추가/교체 건수
    posters_skipped = 0  # 포스터 스킵 건수 (이미 있음 또는 KOPIS도 없음)
    synopsis_added  = 0  # 시놉시스 추가 건수

    process_count = len(pending_docs)

    # ── HTTP 클라이언트 (keep-alive 재사용) ──────────────
    with httpx.Client(follow_redirects=True) as client:
        for idx, doc_snap in enumerate(pending_docs, start=1):
            doc_data   = doc_snap.to_dict()
            title      = doc_data.get("title", "(제목 없음)")
            source_url = doc_data.get("sourceUrl", "")
            m          = re.search(r"mt20id=(PF\w+)", source_url, re.IGNORECASE)
            kopis_id   = m.group(1) if m else ""
            if not kopis_id:
                img_url = doc_data.get("imageUrl", "")
                m2 = re.search(r"/(PF_)?(PF\d+)_", img_url, re.IGNORECASE)
                kopis_id = m2.group(2) if m2 else ""

            # 진행 프리픽스
            prefix = f"[{idx}/{process_count}] {title}"

            # KOPIS ID 없으면 건너뜀
            if not kopis_id or not kopis_id.upper().startswith("PF"):
                print(f"{prefix} ⏭  kopis ID 없음 (건너뜀)")
                skipped += 1
                continue

            # 한 건 처리
            result = enrich_one(
                doc_ref        = doc_snap.reference,
                doc_data       = doc_data,
                client         = client,
                api_key        = args.kopis,
                existing_actors= existing_actors,
                db             = db,
                dry_run        = args.dry_run,
                skip_cast      = args.skip_cast,
                force_poster   = args.force_poster,
            )

            # 아무것도 변경되지 않은 경우 (API 실패 또는 업데이트할 내용 없음)
            if result["cast"] == 0 and not result["poster"] and result["tickets"] == 0 and not result["synopsis"]:
                print(f"{prefix} ⏭  변경 없음 (kopis_id={kopis_id})")
                skipped += 1
            else:
                # 성공 로그 — 변경된 항목만 출력
                parts = []
                if result["cast"]:
                    parts.append(f"캐스트 {result['cast']}명")
                if result["actors"]:
                    parts.append(f"배우 {result['actors']}명 신규등록")
                if result["poster"]:
                    parts.append("포스터")
                if result["tickets"]:
                    parts.append(f"티켓링크 {result['tickets']}개")
                if result["synopsis"]:
                    parts.append("시놉시스")
                label = "dry" if args.dry_run else "✅"
                print(f"{prefix} {label}  {' / '.join(parts)}")
                success       += 1
                total_cast    += result["cast"]
                total_actors  += result["actors"]
                total_tickets += result["tickets"]
                posters_added   += 1 if result["poster"] else 0
                posters_skipped += 1 if result["poster_skipped"] else 0
                synopsis_added  += 1 if result["synopsis"] else 0

            # KOPIS 서버 부하 방지
            time.sleep(args.delay)

    # ── 최종 요약 ────────────────────────────────────────
    print("\n" + "─" * 50)
    print("📊 처리 완료 요약")
    print(f"   전체 처리  : {process_count}건 / 원본 {total}건")
    print(f"   업데이트   : {success}건")
    print(f"   건너뜀     : {skipped}건")
    print(f"   캐스트     : {total_cast}명 추가")
    print(f"   배우 등록  : {total_actors}명 신규")
    print(f"   포스터     : {posters_added}건 추가 / {posters_skipped}건 스킵(이미 있음)")
    print(f"   티켓링크   : {total_tickets}개 추가")
    print(f"   시놉시스   : {synopsis_added}건 추가")
    if args.dry_run:
        print("\n   ※ DRY-RUN 모드 — Firestore에 실제 변경 없음")
    if posters_skipped > 0 and posters_added == 0 and not args.force_poster:
        print(f"\n   💡 포스터 {posters_skipped}건이 이미 있어 스킵됨.")
        print("      기존 URL을 KOPIS 최신 URL로 교체하려면 --force-poster 플래그를 추가하세요.")
    print("─" * 50)


if __name__ == "__main__":
    main()
