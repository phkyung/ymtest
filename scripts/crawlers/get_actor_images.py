"""
get_actor_images.py — actors 컬렉션 배우 사진 자동 수집
─────────────────────────────────────────────────────────
actors 컬렉션에서 imageUrl이 비어있는 배우를 가져와
한국어 위키백과 REST API에서 사진을 검색 후 Firestore 업데이트.

사용법:
    python get_actor_images.py --key path/to/serviceAccountKey.json
    FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' python get_actor_images.py

    # 특정 배우만 처리
    python get_actor_images.py --key key.json --name "김준현"

    # 이미지가 있어도 덮어씀
    python get_actor_images.py --key key.json --overwrite
"""

import argparse
import os
import sys
import time
import tempfile

import httpx
import firebase_admin
from firebase_admin import credentials, firestore

# 위키백과 REST API (CORS 허용, 인증 불필요)
WIKI_SUMMARY_URL = "https://ko.wikipedia.org/api/rest_v1/page/summary/{name}"

# 요청 간 딜레이 (위키미디어 API rate limit 준수)
REQUEST_DELAY = 1.0

HEADERS = {
    "User-Agent": "TheaterArchiveBot/1.0 (https://github.com/; contact@example.com)",
    "Accept": "application/json",
}


# ── Firebase 초기화 ──────────────────────────────
def init_firebase(key_path: str | None = None) -> firestore.Client:
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
        tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        tmp.write(json_str)
        tmp.close()
        cred = credentials.Certificate(tmp.name)
        os.unlink(tmp.name)

    firebase_admin.initialize_app(cred)
    return firestore.client()


# ── 위키백과 이미지 검색 ─────────────────────────
def fetch_wiki_image(name: str, client: httpx.Client) -> str | None:
    """
    한국어 위키백과 REST API에서 배우 이름으로 섬네일 이미지 URL 반환.
    없거나 오류 시 None 반환.
    """
    url = WIKI_SUMMARY_URL.format(name=name)
    try:
        r = client.get(url, headers=HEADERS, timeout=10)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        data = r.json()
        thumbnail = data.get("thumbnail", {})
        source = thumbnail.get("source")
        # 원본 크기 이미지로 교체 (섬네일 URL에서 크기 파라미터 제거)
        if source:
            # /320px- → /800px- 로 업사이즈 (더 선명한 이미지)
            import re
            source = re.sub(r'/\d+px-', '/800px-', source)
        return source
    except httpx.HTTPStatusError as e:
        print(f"  ⚠️  HTTP 오류 ({name}): {e.response.status_code}")
    except Exception as e:
        print(f"  ⚠️  요청 실패 ({name}): {e}")
    return None


# ── 메인 ────────────────────────────────────────
def main(key_path: str | None = None, target_name: str | None = None, overwrite: bool = False) -> None:
    db = init_firebase(key_path)

    print("👤 배우 사진 자동 수집 시작")
    print(f"   조건: {'전체 배우' if not target_name else target_name} "
          f"/ {'이미지 덮어씀' if overwrite else '이미지 없는 배우만'}\n")

    # actors 컬렉션 조회
    actors_ref = db.collection("actors")
    all_docs   = list(actors_ref.stream())

    if target_name:
        targets = [d for d in all_docs if d.to_dict().get("name", "") == target_name]
    elif overwrite:
        targets = all_docs
    else:
        targets = [d for d in all_docs if not d.to_dict().get("imageUrl", "").strip()]

    print(f"🔍 처리 대상: {len(targets)}명 (전체 {len(all_docs)}명 중)\n")

    if not targets:
        print("처리할 배우가 없습니다.")
        return

    updated = skipped = failed = 0

    with httpx.Client(follow_redirects=True) as client:
        for doc_snap in targets:
            data   = doc_snap.to_dict()
            doc_id = doc_snap.id
            name   = data.get("name", "").strip()

            if not name:
                print(f"  ⚠️  이름 없는 문서 스킵 (id={doc_id})")
                skipped += 1
                continue

            print(f"  🔎 [{name}] 위키백과 검색 중...")
            image_url = fetch_wiki_image(name, client)

            if image_url:
                try:
                    actors_ref.document(doc_id).update({"imageUrl": image_url})
                    print(f"     ✅ 이미지 저장: {image_url[:70]}...")
                    updated += 1
                except Exception as e:
                    print(f"     ❌ Firestore 업데이트 실패: {e}")
                    failed += 1
            else:
                print(f"     ⏭  이미지 없음 (위키백과 문서 없거나 사진 미등록)")
                skipped += 1

            time.sleep(REQUEST_DELAY)

    print(f"""
──────────────────────────────
배우 사진 수집 완료
  ✅ 업데이트:  {updated}명
  ⏭  스킵:     {skipped}명
  ❌ 실패:     {failed}명
──────────────────────────────
""")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="배우 사진 자동 수집 (한국어 위키백과)")
    parser.add_argument("--key",       metavar="PATH", help="Firebase 서비스 계정 JSON 키 파일 경로")
    parser.add_argument("--name",      metavar="NAME", help="특정 배우 이름만 처리 (생략 시 전체)")
    parser.add_argument("--overwrite", action="store_true", help="기존 이미지가 있어도 덮어씀")
    args = parser.parse_args()
    main(key_path=args.key, target_name=args.name, overwrite=args.overwrite)
