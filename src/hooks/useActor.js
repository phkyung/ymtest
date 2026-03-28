// ─────────────────────────────────────────────
// useActor.js — 배우 정보 훅
// ─────────────────────────────────────────────
// 배우 기본 정보 + 이 배우가 출연한 공연 목록을 함께 반환합니다.
// ─────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'
import sampleShows from '../data/sampleShows.json'

// 더미 배우 정보 (Firebase 미연결 시)
const DUMMY_ACTORS = {
  actor_001: { id: 'actor_001', name: '김준현', bio: '국내 대표 뮤지컬 배우. 레미제라블, 오페라의 유령 등 대형 뮤지컬에서 주연을 맡아온 베테랑.' },
  actor_002: { id: 'actor_002', name: '박성환', bio: '섬세한 감정 표현으로 알려진 배우. 장발장, 지킬 등 내면 복잡한 역할을 즐겨 맡는다.' },
  actor_003: { id: 'actor_003', name: '이현우', bio: '강렬한 카리스마로 무대를 장악하는 배우. 악역과 권위 있는 역할에 특히 강점을 보인다.' },
  actor_004: { id: 'actor_004', name: '최수진', bio: '서정적이고 감성적인 목소리가 특징. 판틴, 크리스틴 등 애절한 역을 주로 맡는다.' },
  actor_005: { id: 'actor_005', name: '정다은', bio: '자유분방하고 에너지 넘치는 연기. 에포닌, 갈린다 등 개성 강한 역할에 어울린다.' },
  actor_006: { id: 'actor_006', name: '오만석', bio: '헤드윅 역으로 유명한 배우. 1인극에서 탁월한 집중력과 즉흥성을 보여준다.' },
  actor_007: { id: 'actor_007', name: '강태을', bio: '신체 표현력이 뛰어난 배우. 록 뮤지컬에서 무대를 가득 채우는 에너지를 발산한다.' },
  actor_008: { id: 'actor_008', name: '이봉련', bio: '연극계의 베테랑 배우. 햄릿, 메디아 등 고전 비극에서 깊이 있는 해석을 선보인다.' },
  actor_009: { id: 'actor_009', name: '정보석', bio: '연극과 뮤지컬을 넘나드는 중견 배우. 권위 있고 복잡한 아버지 형 역할에 탁월하다.' },
  actor_010: { id: 'actor_010', name: '윤석화', bio: '한국 연극계의 대모. 수십 년 경력의 무게감과 품격이 무대 위에 고스란히 드러난다.' },
  actor_011: { id: 'actor_011', name: '최정원', bio: '뮤지컬 여왕. 넥스트 투 노멀, 시카고 등 강렬한 여성 캐릭터로 독보적 지위를 구축했다.' },
  actor_012: { id: 'actor_012', name: '박은태', bio: '부드러우면서도 결이 있는 바리톤. 따뜻하고 상처받은 남편 역할에 설득력이 넘친다.' },
  actor_013: { id: 'actor_013', name: '김소현', bio: '신인에서 중견으로 성장한 뮤지컬 배우. 젊고 복잡한 감정을 섬세하게 표현한다.' },
  actor_014: { id: 'actor_014', name: '윤나무', bio: '자연스럽고 편안한 연기가 장점인 배우. 일상 속 유머를 공감 있게 전달한다.' },
  actor_015: { id: 'actor_015', name: '장성범', bio: '코미디 타이밍이 탁월한 배우. 앙상블과 주연을 오가며 모든 자리에서 빛을 발한다.' },
}

export function useActor(actorId) {
  const [actor, setActor]     = useState(null)
  const [shows, setShows]     = useState([]) // 이 배우가 출연한 공연들
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!actorId) return

    // 이 배우가 출연한 공연 목록 (더미에서 탐색)
    const actorShows = sampleShows.filter(show =>
      show.cast?.some(c => c.actorId === actorId)
    )
    setShows(actorShows)

    // 더미 모드
    if (!isFirebaseConfigured || !db) {
      setActor(DUMMY_ACTORS[actorId] ?? { id: actorId, name: '배우 정보 없음', bio: '' })
      setLoading(false)
      return
    }

    // Firestore에서 배우 정보 조회
    getDoc(doc(db, 'actors', actorId)).then(snap => {
      if (snap.exists()) {
        setActor({ id: snap.id, ...snap.data() })
      } else {
        // Firestore에 없으면 더미 사용
        setActor(DUMMY_ACTORS[actorId] ?? { id: actorId, name: '배우 정보 없음', bio: '' })
      }
      setLoading(false)
    }).catch(() => {
      setActor(DUMMY_ACTORS[actorId] ?? null)
      setLoading(false)
    })
  }, [actorId])

  return { actor, shows, loading }
}
