"""
backup-actors.py — Firestore actors 컬렉션 전체 백업
사용법:
    python backup-actors.py
    python backup-actors.py --key path/to/service-account.json
    python backup-actors.py --output /tmp/actors_backup.json
"""

import argparse
import json
from datetime import datetime
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore


def init_firebase(key_path: str) -> firestore.Client:
    if firebase_admin._apps:
        return firestore.client()
    cred = credentials.Certificate(key_path)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def main(key_path: str, output: str | None) -> None:
    db = init_firebase(key_path)

    print("actors 컬렉션 읽는 중...")
    docs = list(db.collection("actors").stream())

    actors = []
    for doc in docs:
        data = doc.to_dict()
        data["_id"] = doc.id
        actors.append(data)

    print(f"  → {len(actors)}건 로드 완료")

    if not actors:
        print("백업할 데이터가 없습니다.")
        return

    out_path = Path(
        output or f"actors_backup_{datetime.today().strftime('%Y%m%d')}.json"
    )
    out_path.write_text(
        json.dumps(actors, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    print(f"저장 완료: {out_path} ({len(actors)}건)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Firestore actors 컬렉션 백업")
    parser.add_argument(
        "--key", default="service-account.json",
        help="Firebase 서비스 계정 JSON 경로 (기본: service-account.json)",
    )
    parser.add_argument("--output", default=None, help="출력 파일 경로")
    args = parser.parse_args()
    main(args.key, args.output)
