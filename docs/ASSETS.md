# 기존 플레이판 배포 자산

[기존 런앤레이드 웹판](https://github.com/NewChoBo/oblivion-archive/tree/3fcadc2)에서 같은 영웅 ID와 애니메이션 클립 이름으로 가져왔습니다.

| 사용 위치                                  | 출처                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 기본 영웅 GLB                              | KayKit Adventurers와 Skeletons를 결합한 기존 게임 배포본입니다. 라이선스는 `public/assets/licenses/KayKit-*.txt`에 있습니다. [원본 제작 기록](https://github.com/NewChoBo/oblivion-archive/blob/3fcadc2/asset-sources/Art/ThirdParty/KayKit/SOURCES.md) |
| 화염·타격·마법 파티클                      | Kenney Particle Pack. `public/assets/licenses/Kenney-Particle-Pack.txt`                                                                                                                                                                                 |
| 경기장 바닥·마차·하늘·보스와 선택창 초상화 | 기존 프로젝트의 경기장용 이미지 및 GLB를 사용합니다. Poly Haven 텍스처 출처는 `public/assets/licenses/PolyHaven-SOURCES.md`에 있습니다. [기존 제작 원본](https://github.com/NewChoBo/oblivion-archive/tree/3fcadc2/asset-sources/Art)                   |

개발진 제공 Player 에셋 중 공개가 승인된 경기용 외형 106종을 배포한다. GLB는 `public/assets/fighters/`, 외형과 클립 목록은 `src/content/raid/published-outfits.json`에 있다. 상점에서 캐릭터와 스킨을 선택하면 해당 모델을 미리 볼 수 있다. 85종에는 이름이 지정된 이동 클립이 있으며, 그중 72종에는 경기 클립 9개가 모두 들어 있다. 제작용 FBX와 Blender 작업본, 전체 장면 GLB는 개인 Google Drive에 그룹별로 보관한다. [변환 및 복원 절차](PLAYER-ASSETS.md)

원작 주자 17명의 선택 카드·상세 그림·확정 좌석은 캐릭터별 기본 일러스트를 우선 표시한다. 외부 이미지가 열리지 않으면 배포본의 초상화를 표시한다. 출전 여부가 미확인인 13개 그룹의 카드는 공개 기본 GLB에서 렌더한 개별 프로필을 사용한다. [원작 주자와 창작 스킬 기록](ORIGINAL-ROSTER.md)
