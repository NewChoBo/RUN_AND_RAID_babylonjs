# 개발진 제공 Player 에셋 준비

원본 ZIP은 로컬에서만 사용한다. 게임 플레이는 Babylon.js, 저작 형식 변환은 Blender를 사용한다. 원본 이미지의 RGBA와 원작 장면 파일을 보존하고, 복구할 수 있는 결과를 에셋별로 기록한다.

## 전체 라이브러리 만들기

Python 3.13, uv, Git이 필요하다. 프로젝트 루트에서 실행한다. 첫 변환 시 Blender Python과 공개 MAX 임포터를 다운로드한다.

```powershell
uv run --no-project --python 3.13 --with olefile==0.47 --with pillow==11.1.0 python tools/assets/prepare.py "$env:USERPROFILE/Downloads/Run and Raid Player.zip"
uv run --no-project --python 3.13 --with bpy==5.3.0 --with pillow==11.1.0 python tools/assets/convert.py
uv run --no-project --python 3.13 --with pillow==11.1.0 python tools/assets/verify.py
```

`asset-sources/player/`에는 ZIP의 폴더 구조와 파일을 보존한다. `public/player-assets/catalog.json`은 각 원본 경로·해시·유형·변환 상태와 브라우저용 파일을 연결한다. `models/`에는 정적 GLB 또는 베이크된 애니메이션 GLB, `textures/`에는 무손실 PNG, `rigs/`에는 원본 본·헬퍼 이름과 부모 이름, `previews/`에는 작업 시 저장된 미리보기가 들어간다. 임포터 버전과 중간 기록은 `.asset-work/`에 보관한다. 이 경로들과 베이크한 FBX는 Git에서 제외한다.

| 현재 ZIP 검증 결과              | 수량 |
| ------------------------------- | ---: |
| 전체 원본 파일                  |  973 |
| 정적 메시 GLB                   |  851 |
| 본·헬퍼 계층 JSON               |   25 |
| 원본과 RGBA 픽셀이 일치하는 PNG |   97 |

정적 GLB 851개 중 831개에 텍스처가 들어 있다. 원래 참조한 비트맵 이름이 바뀐 경우에는 같은 영웅과 스킨의 아틀라스가 하나로 좁혀질 때만 연결하며, 근거는 `materialMatches`에 기록한다. `missingBitmaps`는 MAX 제작 시 참조했으나 ZIP에서 같은 이름으로 찾지 못한 비트맵이다. 모션 폴더의 정적 GLB는 단일 자세다. 본 계층 JSON에는 바인드 포즈와 가중치가 없다.

`convert.py --group hammer`로 한 폴더를 지정할 수 있다. 재실행하면 같은 입력으로 완료된 결과는 재사용하고 실패 파일은 다시 시도한다. 원본 버전이 달라졌다면 ZIP과 쌍을 이루는 FBX만 사용한다.

## 원작 모션 내보내기

해머의 기본·달리기·스킬 장면을 직접 시험했다. 사용한 Blender MAX 임포터는 해머의 메시와 UV를 읽지만 원작 스킨 가중치와 키프레임은 가져오지 못했다. 네이티브 내보내기에는 해당 MAX 장면을 열 수 있는 3ds Max와 FBX 플러그인이 필요하다. 현재 작업 PC에서 이 단계는 실행 검증하지 못했다. [Blender MAX 임포터](https://extensions.blender.org/add-ons/io-scene-max/) · [Autodesk FBX 애니메이션 베이크](https://help.autodesk.com/cloudhelp/2023/ENU/3DSMax-Data-Exchange/files/GUID-31EA2A4F-A126-498B-96E8-31811522738A.htm)

```powershell
python tools/assets/bake_fbx.py --maxbatch "C:/Program Files/Autodesk/3ds Max 2025/3dsmaxbatch.exe" --group hammer
uv run --no-project --python 3.13 --with bpy==5.3.0 --with pillow==11.1.0 python tools/assets/convert.py --group hammer
```

3ds Max 경로는 설치 위치에 맞춘다. 각 MAX 장면의 타임라인 범위로 스킨과 애니메이션을 베이크한다. 별도로 받은 FBX도 원본 MAX와 동일한 상대경로로 `asset-sources/baked-fbx/`에 둘 수 있다. 예를 들어 `hammer/Animation/hammer#default#run.max`는 `hammer/Animation/hammer#default#run.fbx`와 짝을 이룬다. 변환기는 짝을 이루는 FBX를 우선하고 내보낸 GLB에서 실제 스킨과 클립이 모두 있을 때만 `animated`로 표시한다.

경기용 영웅은 기본 모델 하나에 스킨과 게임용 아홉 클립을 합친 구조다. 각 스킬의 여러 원본 단계가 어느 클립에 해당하는지는 실제 동작과 공식 스킬표를 대조한 뒤 결정한다.

## 경기 모델로 등록

영웅의 스킨 메시와 9개 클립을 하나의 GLB로 정리한 뒤 아래 명령을 실행한다. 예제 경로는 준비한 파일로 바꾼다.

```powershell
python tools/assets/activate.py hammer C:/art/hammer-ready.glb
```

등록 가능한 클립 이름은 `run`, `walk`, `jump`, `fall`, `basic`, `pulse`, `bolt`, `field`, `fury`이다. 스킨이 없거나 클립이 빠진 GLB는 등록하기 전에 오류를 표시한다. 게임은 등록한 영웅의 원래 재질과 장비를 사용한다. 등록하지 않은 영웅은 로컬 원작 목록에서 같은 영웅 ID의 기본 외형을 찾고, 대응되는 외형이 없으면 기존 모델을 사용한다. 로컬 등록 뒤 개발 서버를 다시 열거나 배포본을 다시 빌드한다. 베이크 모델 등록을 해제하려면 `src/content/raid/ready-heroes/<hero>.json`을 제거한다.

## 경기 카메라에서 원작 외형 확인

영웅 외형은 개발진 제공 원작 모델·텍스처·무기와 복원 가능한 원작 모션을 우선한다. 준비 중인 영웅은 기존 범용 모델과 모션을 임시 사용한다. 공개 배포 범위가 확인된 경기용 결과물만 개별 검토해 공개 에셋 해시 목록에 추가한다. 원본 묶음·전체 변환본·팬카페 자료는 로컬에 보관한다.

공개판과 로컬판 시작 화면의 **주자 선택**에서 전투 능력을, **봇 연습 외형**에서 캐릭터와 스킨을 고른다. 변환기가 로컬 전용 목록을 생성한다. 현재 제공본은 31개 그룹이며 기본 체형, 몬스터와 동반자를 포함한다. 캐릭터와 영웅 ID가 일치하면 봇도 해당 기본 외형을 사용한다. 애니메이션 장면의 개별 자세와 장비 부품은 에셋 열람 화면에서 확인할 수 있다.

특정 원본 장면을 직접 확인하려면 로컬 Vite에서 해당 영웅으로 봇 경기를 시작한 뒤 브라우저 콘솔에서 실행한다. 다른 영웅은 ID와 카탈로그의 원본 경로를 바꾼다. 새로고침하면 원래 모델로 돌아온다.

```js
const { previewStaticHero } = await import('/tools/assets/preview-static.js');
await previewStaticHero('hammer', 'hammer/hammer#default.max');
```

이 미리보기는 경기 카메라에서 외형을 살피도록 크기와 발 높이를 임시 조정한다. 해머 기본 모델은 본체 메시와 텍스처가 보이며 스킨과 클립은 0개다. 달리기, 평타 1·2, 스킬 1~4 시작 장면의 현재 변환본도 단일 자세다. 원작 무기 장착과 모션 재생은 아직 검증하지 못했다. 위 FBX 베이크 경로로 스킨과 클립을 확보하면 경기에서 달리기·평타·스킬을 각각 확인하고 영웅별로 원작 복원 클립과 대체 클립을 기록한다.
