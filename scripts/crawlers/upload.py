"""
upload.py — pending_shows.json → Firestore pending 컬렉션 업로드
──────────────────────────────────────────────────────────────────
사용법:
    # 로컬 실행 (서비스 계정 키 파일 직접 지정)
    python upload.py --key path/to/serviceAccountKey.json

    # GitHub Actions (환경변수로 JSON 내용 전달)
    FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' python upload.py

필요 환경:
    - Python 3.9+
    - pip install firebase-admin
    - Firebase 서비스 계정 키 (Firebase Console → 프로젝트 설정 → 서비스 계정)
"""

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

# ── 설정 ────────────────────────────────────────
INPUT_FILE      = Path(__file__).parent / "pending_shows.json"
COLLECTION_NAME = "pending"


# ── Firebase 초기화 ──────────────────────────────
def init_firebase(key_path: str | None = None) -> firestore.Client:
    """
    서비스 계정 키로 Firebase Admin SDK 초기화.
    key_path 없으면 환경변수 FIREBASE_SERVICE_ACCOUNT_JSON 사용.
    """
    if firebase_admin._apps:
        # 이미 초기화된 경우 재사용
        return firestore.client()

    if key_path:
        # 파일 경로로 초기화
        cred = credentials.Certificate(key_path)
    else:
        # 환경변수에서 JSON 문자열로 초기화 (GitHub Actions 용)
        json_str = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        if not json_str:
            print("❌ Firebase 인증 정보가 없습니다.")
            print("   --key 옵션 또는 FIREBASE_SERVICE_ACCOUNT_JSON 환경변수를 설정하세요.")
            sys.exit(1)

        # 임시 파일에 써서 Certificate 초기화 (SDK가 파일 경로를 요구)
        tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        tmp.write(json_str)
        tmp.close()
        cred = credentials.Certificate(tmp.name)
        os.unlink(tmp.name)  # 사용 후 즉시 삭제

    firebase_admin.initialize_app(cred)
    return firestore.client()


# ── cast 정규화 ─────────────────────────────────
def normalize_cast(cast: list) -> list[dict]:
    """
    Firestore는 중첩 배열을 허용하지 않으므로 cast 필드를 업로드 전 정규화.

    입력 가능한 형태:
      - []                                      → []
      - ["홍길동", "이순신"]                    → [{"actorName": "홍길동", ...}, ...]
      - [["홍길동", "이순신"]]                  → [{"actorName": "홍길동", ...}, ...]  # 중첩배열 평탄화
      - [{"actorName": "홍길동", "roleName": ""}]  → 그대로 유지

    반환: [{"actorName": str, "roleName": str}, ...]
    """
    result: list[dict] = []
    for item in cast:
        if isinstance(item, dict):
            result.append({
                "actorName": str(item.get("actorName", "") or item.get("name", "")),
                "roleName":  str(item.get("roleName", "")),
            })
        elif isinstance(item, list):
            # 중첩 배열: 내부 요소를 꺼내 재귀 처리
            result.extend(normalize_cast(item))
        elif isinstance(item, str) and item.strip():
            result.append({"actorName": item.strip(), "roleName": ""})
    return result


# ── 중복 체크 ───────────────────────────────────
def is_duplicate(db: firestore.Client, title: str, start_date: str) -> bool:
    """
    pending 또는 shows 컬렉션에 동일한 (제목 + 시작일) 공연이 있으면 True.
    두 컬렉션 모두 확인해 승인된 공연도 재등록되지 않도록 함.
    """
    for collection in ("pending", "shows"):
        query = (
            db.collection(collection)
            .where("title", "==", title)
            .where("startDate", "==", start_date)
            .limit(1)
        )
        if query.get():  # 결과가 1개라도 있으면 중복
            return True
    return False


# ── 업로드 ──────────────────────────────────────
def upload(db: firestore.Client, shows: list[dict]) -> tuple[int, int, int]:
    """
    공연 목록을 pending 컬렉션에 업로드.
    반환: (성공, 중복 스킵, 실패) 카운트
    """
    success = skipped = failed = 0

    for show in shows:
        title      = show.get("title", "").strip()
        start_date = show.get("startDate", "")

        if not title:
            print("  ⚠️  제목 없는 항목 스킵")
            skipped += 1
            continue

        # 중복 확인
        if is_duplicate(db, title, start_date):
            print(f"  ↩️  중복 스킵: {title} ({start_date})")
            skipped += 1
            continue

        # 고유 ID 생성: 제목 + 시작일 기반 (공백→언더스코어, 특수문자 제거)
        import hashlib
        id_source = f"{title}_{start_date}"
        doc_id = "pending_" + hashlib.md5(id_source.encode()).hexdigest()[:10]

        # Firestore 서버 타임스탬프로 교체 + cast 정규화 (중첩 배열 제거)
        from firebase_admin.firestore import SERVER_TIMESTAMP
        show_to_save = {
            **show,
            "id":          doc_id,
            "cast":        normalize_cast(show.get("cast", [])),
            "status":      "pending",
            "collectedAt": SERVER_TIMESTAMP,
        }

        try:
            db.collection(COLLECTION_NAME).document(doc_id).set(show_to_save)
            print(f"  ✅ 업로드: {title} ({start_date} ~ {show.get('endDate', '')})")
            success += 1
        except Exception as e:
            print(f"  ❌ 실패: {title} — {e}")
            failed += 1

    return success, skipped, failed


# ── 메인 ────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="pending_shows.json → Firestore 업로드")
    parser.add_argument(
        "--key", metavar="PATH",
        help="Firebase 서비스 계정 JSON 키 파일 경로 (없으면 환경변수 사용)",
    )
    parser.add_argument(
        "--input", metavar="PATH", default=str(INPUT_FILE),
        help=f"입력 JSON 파일 경로 (기본: {INPUT_FILE})",
    )
    args = parser.parse_args()

    # 입력 파일 확인
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"❌ 입력 파일을 찾을 수 없습니다: {input_path}")
        sys.exit(1)

    shows = json.loads(input_path.read_text(encoding="utf-8"))
    print(f"📂 {input_path.name} 로드 완료: {len(shows)}개 공연")

    if not shows:
        print("업로드할 공연이 없습니다.")
        return

    # Firebase 초기화 및 업로드
    db = init_firebase(args.key)
    print(f"\n☁️  Firestore '{COLLECTION_NAME}' 컬렉션에 업로드 시작\n")

    success, skipped, failed = upload(db, shows)

    print(f"""
──────────────────────────────
업로드 결과
  ✅ 성공:     {success}개
  ↩️  중복 스킵: {skipped}개
  ❌ 실패:     {failed}개
──────────────────────────────
관리자 페이지에서 대기 중 탭을 확인하세요.
""")


if __name__ == "__main__":
    main()
