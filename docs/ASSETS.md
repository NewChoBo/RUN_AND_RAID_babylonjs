# 기존 플레이판 배포 자산

[기존 런앤레이드 웹판](https://github.com/NewChoBo/oblivion-archive/tree/3fcadc2)에서 같은 영웅 ID와 애니메이션 클립 이름으로 가져왔습니다.

| 사용 위치                                  | 출처                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 기본 영웅 GLB                              | KayKit Adventurers와 Skeletons를 결합한 기존 게임 배포본입니다. 라이선스는 `public/assets/licenses/KayKit-*.txt`에 있습니다. [원본 제작 기록](https://github.com/NewChoBo/oblivion-archive/blob/3fcadc2/asset-sources/Art/ThirdParty/KayKit/SOURCES.md) |
| 화염·타격·마법 파티클                      | Kenney Particle Pack. `public/assets/licenses/Kenney-Particle-Pack.txt`                                                                                                                                                                                 |
| 경기장 바닥·마차·하늘·보스와 선택창 초상화 | 기존 프로젝트의 경기장용 이미지 및 GLB를 사용합니다. Poly Haven 텍스처 출처는 `public/assets/licenses/PolyHaven-SOURCES.md`에 있습니다. [기존 제작 원본](https://github.com/NewChoBo/oblivion-archive/tree/3fcadc2/asset-sources/Art)                   |

개발진 제공 Player 에셋 중 공개가 승인된 외형 106종을 배포한다. GLB는 `public/assets/fighters/`, 외형과 클립 목록은 `src/content/raid/published-outfits.json`에 있다. 상점에서 캐릭터와 스킨을 선택하면 해당 모델을 미리 볼 수 있다. 85종에는 이름이 지정된 이동 클립이 있으며, 그중 72종에는 경기 클립 9개가 모두 들어 있다. 제작용 FBX와 Blender 작업본, 전체 장면 GLB는 개인 Google Drive에 그룹별로 보관한다. [변환 및 복원 절차](PLAYER-ASSETS.md)

픽 목록은 원작 주자 17명의 카페 공략 이미지에서 얼굴만 잘라 보여 준다. 이미지를 불러오는 동안이나 연결이 끊긴 경우에는 배포본의 모델 초상에서 얼굴을 보여 준다. 출전 여부가 미확인인 13개 그룹은 각자의 공개 기본 GLB에서 얼굴을 192×192로 렌더한 `assets/raid/pick-faces/` 이미지를 쓴다. 연습 주자 3명은 기존 초상에서 얼굴을 잘라 쓴다. 픽창의 출전 스킨은 주자 상세, 팀 좌석, 봇전과 온라인 경기에서 같은 외형을 사용한다. 원작 주자 17명의 일러스트에 연결한 54종과 임시 주자 13명의 기본 모델이 출전할 수 있다. 공용 체형과 대응 스킨이 확인되지 않은 외형을 포함한 나머지 39종은 감상실에서 볼 수 있다. 선택한 외형은 기술 판정에 영향을 주지 않는다. 카페 원화를 불러올 수 없을 때에도 선택한 의상을 유지하도록 기본 외형 이외의 37종은 출전 GLB를 렌더한 WebP를 `public/assets/raid/skin-previews/`에 제공한다. [원작 주자와 창작 스킬 기록](ORIGINAL-ROSTER.md)

픽창의 원작 스킬표는 패시브 17개와 액티브 72개의 원본 도안을 가이드 순서로 표시한다. 매그너스의 두 모드가 각각 네 칸이다. 96×96 PNG 중 84장은 운영진 공략용 모음에서, 프리지아의 5장은 개별 가이드에서 확인했다. 공개판은 카페의 이미지 주소를 사용한다. 개발 서버에서는 `public/player-assets/skill-icons/`에 원래 파일명(예: `hammer0.png`)으로 보관한 PNG를 먼저 읽는다. [운영진 아이콘 모음](https://cafe.naver.com/runandraid/5931) · [프리지아 가이드](https://cafe.naver.com/runandraid/36547) · [파일별 주소](../src/content/raid/skill-icons.json)

전투 버튼과 픽창의 플레이판 기술에는 같은 도안을 사용한다. 원작과 동작이 다른 기술에는 그림을 빌려 썼다. 호프는 냉기포탑·제트엔진·원격폭발·연발포탑 그림을, 어비스는 3·1·2·4번, 발렛은 1·3·2·4번 그림을 쓴다. 매그너스의 모드 전환 버튼은 누르면 들어갈 모드의 그림을 쓴다. 원작 기술명과 그림의 조합은 픽창의 **원작 스킬표**에서 확인할 수 있다. [호프](https://cafe.naver.com/runandraid/5738) · [어비스](https://cafe.naver.com/runandraid/5741) · [발렛](https://cafe.naver.com/runandraid/22713) · [매그너스](https://cafe.naver.com/runandraid/5743)
