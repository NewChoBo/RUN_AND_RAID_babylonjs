# 개발진 제공 Player 에셋 준비

## 현재 작업본과 경기 에셋

Google Drive의 **Run and Raid - Player Assets**에서 `Blender/<그룹>.blend`를 내려받아 편집한다. Scene 선택기의 각 장면은 원본 MAX 한 개와 대응한다. `FBX/<그룹>.zip`에는 FBX와 텍스처가 있다. `GLB/<그룹>.zip`의 `Scenes/`에는 원본별 GLB, `Outfits/`에는 경기·상점용 GLB, `index.json`에는 출처와 클립 매핑이 있다. 다운로드한 파일은 Drive 루트의 `SHA256SUMS.txt`로 검사할 수 있다.

게임과 Drive에서 같은 외형은 같은 파일명을 쓴다. 예를 들어 해머 근위대 외형은 `hammer-royalguard.glb`, 해머 기본 달리기는 `hammer-default-run.glb`와 `hammer-default-run.fbx`, 기본 편집 장면은 `hammer-default-scene.glb`다. 구버전·변형 장면은 원본의 하위 폴더 이름까지 덧붙인다. 각 FBX의 원본 MAX 경로와 프레임 범위는 `fbx-index.csv`에서 찾을 수 있다. FBX에 연결된 원본 TGA는 재연결에 쓰이는 이름을 유지한다.

31개 그룹의 장면 GLB 876개 중 851개에는 메시가 있고, 25개는 본·헬퍼 장면이다. 별도 제작된 걷기가 없는 경기 모델은 달리기를 느리게 사용한다. 칼리의 중독은 다음 평타를 강화하므로 전용 원본이 없는 이 슬롯에 평타 동작을 연결했다. 피부·의상 디퓨즈의 알파는 마스크로 보존하고 경기용 본체는 불투명하게 렌더링한다. 일부 제작용 장면은 원본 ZIP에 없는 텍스처를 참조한다. 편집 파일의 장면 속성과 그룹별 GLB 색인에 해당 참조를 기록했다.

원본 ZIP을 준비한 작업 환경에서 전체 라이브러리를 다시 만들 때는 Drive의 FBX 압축을 `asset-sources/baked-fbx/`에 푼다. 편집 작업본의 출력은 `.asset-work/player-release/Blender/`다. 이미 Drive에서 받은 작업본이 있으면 `glb` 단계부터 실행한다.

```powershell
uv run --no-project --python 3.13 --with bpy==5.3.0 --with pillow==11.1.0 python tools/assets/player_archive.py blend --timeline "C:/art/fbx-index.csv"
uv run --no-project --python 3.13 --with bpy==5.3.0 --with pillow==11.1.0 python tools/assets/player_archive.py glb
uv run --no-project --python 3.13 --with bpy==5.3.0 python tools/assets/assemble_player.py --outfits
python tools/assets/package_players.py --fbx-index "C:/art/fbx-index.csv"
uv run --no-project --python 3.13 --with pillow==11.1.0 python tools/assets/verify.py
```

원본 ZIP은 로컬에서만 사용한다. 게임 플레이는 Babylon.js, 저작 형식 변환은 Blender를 사용한다. 원본 이미지의 RGBA와 원작 장면 파일을 보존하고, 복구할 수 있는 결과를 에셋별로 기록한다.

## 전체 라이브러리 만들기

Python 3.13, uv, Git이 필요하다. 프로젝트 루트에서 실행한다. 첫 변환 시 Blender Python과 공개 MAX 임포터를 다운로드한다.

```powershell
uv run --no-project --python 3.13 --with olefile==0.47 --with pillow==11.1.0 python tools/assets/prepare.py "$env:USERPROFILE/Downloads/Run and Raid Player.zip"
uv run --no-project --python 3.13 --with bpy==5.3.0 --with pillow==11.1.0 python tools/assets/convert.py
uv run --no-project --python 3.13 --with pillow==11.1.0 python tools/assets/verify.py
```

`asset-sources/player/`에는 ZIP의 폴더 구조와 파일을 보존한다. `public/player-assets/catalog.json`은 각 원본 경로·해시·유형·변환 상태와 브라우저용 파일을 연결한다. `models/`에는 정적 GLB 또는 베이크된 애니메이션 GLB, `textures/`에는 무손실 PNG, `rigs/`에는 원본 본·헬퍼 이름과 부모 이름, `previews/`에는 작업 시 저장된 미리보기가 들어간다. 임포터 버전과 중간 기록은 `.asset-work/`에 보관한다. 이 경로들과 베이크한 FBX는 Git에서 제외한다.

| 최초 정적 임포트 검증 결과      | 수량 |
| ------------------------------- | ---: |
| 전체 원본 파일                  |  973 |
| 정적 메시 GLB                   |  851 |
| 본·헬퍼 계층 JSON               |   25 |
| 원본과 RGBA 픽셀이 일치하는 PNG |   97 |

정적 GLB 851개 중 831개에 텍스처가 들어 있다. 원래 참조한 비트맵 이름이 바뀐 경우에는 같은 영웅과 스킨의 아틀라스가 하나로 좁혀질 때만 연결하며, 근거는 `materialMatches`에 기록한다. `missingBitmaps`는 MAX 제작 시 참조했으나 ZIP에서 같은 이름으로 찾지 못한 비트맵이다. 모션 폴더의 정적 GLB는 단일 자세다. 본 계층 JSON에는 바인드 포즈와 가중치가 없다.

`convert.py --group hammer`로 한 폴더를 지정할 수 있다. 재실행하면 같은 입력으로 완료된 결과는 재사용하고 실패 파일은 다시 시도한다. 원본 버전이 달라졌다면 ZIP과 쌍을 이루는 FBX만 사용한다.

## Blender 작업본 열기

위의 `prepare.py`로 원본 ZIP을 준비한 뒤, 영웅 본체와 비교할 모션 장면을 하나의 편집용 파일로 만들 수 있다. 다음 명령은 해머를 예로 든다.

```powershell
uv run --no-project --python 3.13 --with bpy==5.3.0 python tools/assets/prepare_blend.py hammer --motion 'Animation/hammer#default#run.max' --motion 'Animation/hammer#default#attack1.max' --motion 'Animation/hammer#default#skill1start.max'
```

Blender에서 `.asset-work/blender/hammer.blend`를 연다. 처음 열리는 `Model` 장면에서 본체를 편집하고, 상단 Scene 선택기로 `Reference` 장면을 열어 달리기·평타·스킬 원본을 확인한다. Text Editor의 `PORTING.txt`에는 장면별 MAX 경로, 가져온 Armature와 Action 수, 원본 모션 목록, 게임이 요구하는 클립 이름이 있다. 다른 작업본은 `--output`으로 새 파일명을 지정한다. 결과물은 로컬에 저장하며, 원본 텍스처는 작업본에 패킹한다.

직접 가져올 때는 Blender의 **Preferences → Get Extensions**에서 **Import Autodesk MAX (.max)**를 설치한 뒤 **File → Import → Autodesk MAX (.max)**를 사용한다. Blender 5.3과 확장 1.9.2로 해머 본체·달리기·평타 1·스킬 1 시작을 각각 열었다. 각 장면에서 메시 1개와 Empty 42개가 나왔고, Armature·가중치가 있는 정점·Action은 모두 0개였다. 본체의 512×512 디퓨즈 텍스처는 패킹된 상태로 다시 열었다. [Blender 확장](https://extensions.blender.org/add-ons/io-scene-max/) · [Biped 처리 변경 기록](https://extensions.blender.org/add-ons/io-scene-max/versions/?page=5)

Blender에서 새 모션을 제작할 때는 `Model` 장면에서 리그를 만들고 메시 가중치를 연결한다. 현재 게임의 대체 리그와 9개 클립은 [해머 게임 모델](../public/assets/raid/hammer.glb)을 Blender에서 별도로 가져와 비교할 수 있다. 원작 키프레임을 옮기려면 아래 절차로 같은 소스의 FBX를 만든다. `prepare_blend.py`는 해당 FBX가 있으면 장면별로 우선 사용한다.

## 원작 모션 내보내기

Player 원본 31개 그룹의 MAX 장면 876개를 `asset-sources/baked-fbx/`에 같은 폴더 구조로 추출했다. Blender 5.3에서 876개를 모두 열었고, 프레임을 샘플링한 결과 744개에서 본이 움직였다. 로컬 `.asset-work/max2027/fbx-index.csv`에 장면별 재생 구간, 가중치 정점 수, 움직임을 확인한 본과 메시 수, 다시 연결할 텍스처 이름을 기록했다.

3ds Max 2027.3에서 원본 장면을 FBX로 내보내고 Blender 5.3에서 다시 열었다. 해머 달리기는 30fps, 0~24프레임이며 본 58개와 가중치가 있는 정점 1,037개의 움직임을 확인했다. 로컬 작업본 `.asset-work/blender/hammer-native.blend`를 열면 달리기가 재생 준비된 상태다. 상단 Scene 선택기에서 기본 모델과 원본 모션 28개를 열 수 있다. 각 장면은 원래 리그와 재생 구간을 유지한다. [Autodesk FBX 애니메이션 베이크](https://help.autodesk.com/cloudhelp/2023/ENU/3DSMax-Data-Exchange/files/GUID-31EA2A4F-A126-498B-96E8-31811522738A.htm)

```powershell
python tools/assets/bake_fbx.py --maxbatch "C:/Program Files/Autodesk/3ds Max 2025/3dsmaxbatch.exe" --group hammer
uv run --no-project --python 3.13 --with bpy==5.3.0 --with pillow==11.1.0 python tools/assets/convert.py --group hammer
```

3ds Max 경로는 설치 위치에 맞춘다. 각 MAX 장면의 타임라인 범위로 스킨과 애니메이션을 베이크한다. `hammer/Animation/hammer#default#run.max`의 출력은 `asset-sources/baked-fbx/hammer/Animation/hammer-default-run.fbx`다. 변환기는 이전 파일명 `hammer#default#run.fbx`도 읽으며, 내보낸 GLB에서 실제 스킨과 클립이 모두 있을 때만 `animated`로 표시한다.

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

이 미리보기 도구는 개별 장면을 경기 카메라에서 점검할 때 사용한다. 상점과 경기에서는 외형별 게임용 GLB를 읽는다. 해머 봇 경기에서 본체와 무기, 달리기, 타격 시 자세를 확인했다.
