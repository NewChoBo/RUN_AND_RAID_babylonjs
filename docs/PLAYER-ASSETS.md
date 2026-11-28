# 개발진 제공 Player 에셋 준비

## 현재 작업본과 경기 에셋

Google Drive의 **Run and Raid - Player Assets**에서 `Blender/<그룹>.blend`를 내려받아 편집한다. Scene 선택기의 각 장면은 원본 MAX 한 개와 대응한다. `FBX/<그룹>.zip`에는 FBX와 텍스처가 있다. `GLB/<그룹>.zip`의 `Scenes/`에는 원본별 GLB, `Outfits/`에는 경기·상점용 GLB, `index.json`에는 출처와 클립 매핑이 있다. 다운로드한 파일은 Drive 루트의 `SHA256SUMS.txt`로 검사할 수 있다.

게임과 Drive에서 같은 외형은 같은 파일명을 쓴다. 예를 들어 해머 근위대 외형은 `hammer-royalguard.glb`, 해머 기본 달리기는 `hammer-default-run.glb`와 `hammer-default-run.fbx`, 기본 편집 장면은 `hammer-default-scene.glb`다. 구버전·변형 장면은 원본의 하위 폴더 이름까지 덧붙인다. 각 FBX의 원본 MAX 경로와 프레임 범위는 `fbx-index.csv`에서 찾을 수 있다. FBX에 연결된 원본 TGA는 재연결에 쓰이는 이름을 유지한다.

31개 그룹의 장면 GLB 876개 중 851개에는 메시가 있고, 25개는 본·헬퍼 장면이다. 별도 제작된 걷기가 없는 경기 모델은 대응하는 달리기·비행·대기 장면의 원래 길이를 사용한다. 칼리의 중독은 다음 평타를 강화하므로 전용 원본이 없는 이 슬롯에 평타 동작을 연결했다. 피부·의상 디퓨즈의 알파는 마스크로 보존하고 경기용 본체는 불투명하게 렌더링한다. 일부 제작용 장면은 원본 ZIP에 없는 텍스처를 참조한다. 편집 파일의 장면 속성과 그룹별 GLB 색인에 해당 참조를 기록했다.

원본 ZIP을 준비한 작업 환경에서 전체 라이브러리를 다시 만들 때는 Drive의 FBX 압축을 `asset-sources/baked-fbx/`에 푼다. 편집 작업본의 출력은 `.asset-work/player-release/Blender/`다. 이미 Drive에서 받은 작업본이 있으면 `glb` 단계부터 실행한다.

```powershell
uv run --no-project --python 3.13 --with bpy==5.3.0 --with pillow==11.1.0 python tools/assets/player_archive.py blend --timeline "C:/art/fbx-index.csv"
uv run --no-project --python 3.13 --with bpy==5.3.0 --with pillow==11.1.0 python tools/assets/player_archive.py glb
uv run --no-project --python 3.13 --with bpy==5.3.0 python tools/assets/assemble_player.py --plan
$env:RUN_RAID_PROJECT = (Resolve-Path .).Path
& "D:/Work/3DSMAX/3ds Max 2027/3dsmaxbatch.exe" (Resolve-Path tools/assets/max_motion_reference.py).Path
uv run --no-project --python 3.13 --with bpy==5.3.0 python tools/assets/prepare_motion_reference.py
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

등록 가능한 클립 이름은 `run`, `walk`, `jump`, `fall`, `basic`, `pulse`, `bolt`, `field`, `fury`이다. 스킨이 없거나 클립이 빠진 GLB는 등록하기 전에 오류를 표시한다. 게임은 출전 스킨에 연결된 공개 GLB를 먼저 사용한다. 공개 기본 모델이 없는 주자는 영웅 ID로 등록한 로컬 GLB, 기존 연습 모델 순으로 사용한다. 로컬 등록 뒤 개발 서버를 다시 열거나 배포본을 다시 빌드한다. 베이크 모델 등록을 해제하려면 `src/content/raid/ready-heroes/<hero>.json`을 제거한다.

## 경기 카메라에서 원작 외형 확인

영웅 외형은 개발진 제공 원작 모델·텍스처·무기와 복원 가능한 원작 모션을 우선한다. 준비 중인 영웅은 기존 범용 모델과 모션을 임시 사용한다. 공개 배포 범위가 확인된 경기용 결과물만 개별 검토해 공개 에셋 해시 목록에 추가한다. 원본 묶음·전체 변환본·팬카페 자료는 로컬에 보관한다.

픽창의 **출전 스킨**이 팀 좌석의 일러스트와 봇전·온라인 경기의 GLB를 함께 정한다. 각 원작 스킨은 `draft-catalog.json`의 `art`와 `modelSkin`으로 연결하며, 캐릭터와 모델 키가 모두 일치해야 출전할 수 있다. 자료가 추가되면 이 대응표를 갱신한다. 임시 주자는 각자 확인한 기본 모델만 사용한다. 추가 로컬 외형과 미대응 모델은 감상실에 표시한다.

테레사의 견습 기사는 `varlet`, 가디언은 `retinue`다. 용병 길드 일러스트는 롱샷과 칼리가 공유하며 각자 자기 모델을 사용한다. 해군복 발렛과 사신 어비스는 설정화와 모델을 대조해 연결했고 정식 출시명은 미확인이다. 폭주화 드리즈는 일러스트와 일치하지만 GLB에 모션 클립이 없어 픽창에 **모션 미복원**으로 표시한다.

레이디 발렛은 텍스처가 든 `vallet/skin1`을 사용한다. 원본 `vallet#lady_skindata.max`가 그 텍스처를 참조하고, 공식 일러스트의 의상·무기가 일치한다. `vallet/lady`는 같은 UV의 제작용 변형으로 참조 텍스처가 원본 ZIP에서 확인되지 않아 감상실에 둔다. 애니메이션 장면의 개별 자세와 장비 부품은 에셋 열람 화면에서 확인할 수 있다.

특정 원본 장면을 직접 확인하려면 로컬 Vite에서 해당 영웅으로 봇 경기를 시작한 뒤 브라우저 콘솔에서 실행한다. 다른 영웅은 ID와 카탈로그의 원본 경로를 바꾼다. 새로고침하면 원래 모델로 돌아온다.

```js
const { previewStaticHero } = await import('/tools/assets/preview-static.js');
await previewStaticHero('hammer', 'hammer/hammer#default.max');
```

이 미리보기 도구는 개별 장면을 경기 카메라에서 점검할 때 사용한다. 상점과 경기에서는 외형별 게임용 GLB를 읽는다. 해머 봇 경기에서 본체와 무기, 달리기, 타격 시 자세를 확인했다.

## 장비 위치와 재생 시간 복원

### 출발선의 대기 자세

원작 챔피언 17명의 출전 외형 54종과 추가 복원 주자 6명의 기본형에서 `idle`을 복원했다. 각 외형에 대응하는 대기 장면을 먼저 찾고, 전용 장면이 없으면 같은 주자의 호환되는 기본 대기를 사용한다. 해머와 롱샷 기본형의 한 주기는 1.50초, 롱샷 근위대는 1.67초, 매그너스는 3.00초다. 원작이 출발선에서 `idle`, `idle2` 등 어떤 변형을 선택했는지는 확인되지 않아 기본 대기를 채택했다.

폭주화 드리즈(`drizz/demon`)의 완성 메시는 정적이었다. 같은 스킨의 `#demon#body.max`와 `#demon#righthand.max`에서 원본 가중치를 읽었다. UV와 바인드 자세의 가로·높이 좌표로 완성 메시의 정점 2,034개에 대응시킨 뒤, 드리즈의 몸과 오른손을 모두 포함하는 원본 리그에 연결했다. 이 외형은 대기부터 달리기·공격까지 원본 모션 10개를 사용한다. Drive 그룹 ZIP의 `index.json`에 가중치 출처를 기록한다.

버드는 출발선에서 자기 비행 모션을 재생한다. 별도 대기 모션을 찾지 못한 `demon`, `demonslayer`, `ent`, `general`, `goblin`, `shaman`은 출발 자세를 유지한다. 연습 주자 렌드·바스티온·라임은 각 KayKit 원본의 `Idle`을 사용한다.

### 전투 모션의 대조 방법

Max Batch는 원본 장면별 FPS, 프레임당 틱, 시작·끝 틱, 미리보기 속도·실시간·반복 설정, 프레임 태그와 노트 키를 읽는다. 경기용 모션은 매 프레임 각 Skin 본의 정점 위치도 읽는다. 재생 시간은 `(끝 틱 − 시작 틱) / (프레임당 틱 × FPS)`로 구한다. Max 미리보기 속도는 편집기 설정으로 따로 보관한다. [Autodesk 시간 설정](https://help.autodesk.com/cloudhelp/2026/ENU/MAXScript-Help/files/MAXScript-Tools-and-Interaction/Interacting-with-the-3ds-Max/Time-Control/GUID-0E38D992-E687-4A0D-80BB-875F0BAD021E.html)

`prepare_motion_reference.py`는 몸의 대응 정점으로 각 장면의 Max·FBX 단위와 방향을 맞춘다. 원본 위치와 다른 단단한 장비는 여러 정점이 함께 설명하는 회전·이동을 구해 장면의 프레임별 보정값을 기록한다. 외형별 바인드 포즈에 보정을 적용해 출력한 뒤, GLB를 다시 열어 시작·중간·끝의 손과 장비 정점 및 트랙 길이를 재검사한다. 이 비교는 주자를 따라가는 좌표계에서 수행한다. 해머의 망치, 롱샷의 활·화살처럼 독립적으로 움직이는 장비에는 각각의 원본 궤적을 적용한다.

비공개 Drive의 `GLB/<그룹>.zip` 안에 있는 `Reference/<그룹 소문자>.json.gz`에는 시간·장면·보정 자료가 있다. 압축을 풀어 `.asset-work/player-release/Reference/`에 두면 Max 추출을 반복하지 않고 해당 외형을 다시 베이크할 수 있다. `Reference/max-timing.csv`는 그룹 시간표이고, Drive 루트의 `max-timing.csv`는 전체 시간표다. GLB의 각 애니메이션에도 `extras.sourceTiming`으로 원본 시간값이 들어 있다. 원본에 태그가 없으면 빈 목록으로 기록한다.

```powershell
uv run --no-project --python 3.13 --with bpy==5.3.0 python tools/assets/assemble_player.py --outfits hammer longshot
python tools/assets/package_players.py --groups hammer longshot
uv run --no-project --python 3.13 --with bpy==5.3.0 python tools/assets/verify_player_motion.py hammer longshot --out .asset-work/grip-check.json
```

정점 대조에는 원본 장면을 읽어 만든 `.asset-work/max-motion/`이 필요하다. 일괄 열기에서 실패한 장면은 해당 폴더의 `*.error`에 원본 경로가 남는다. 해당 경로를 `RUN_RAID_REFERENCE_FILE`에 넣고 같은 Max Batch 명령에 `-sceneFile <원본 절대경로>`를 추가해 새 프로세스에서 복구할 수 있다. 필터를 사용한 뒤에는 환경 변수를 해제한다.

### 호프 포탑 9종

변환된 원본 GLB가 `public/player-assets/models/hof/`에 있으면 저장소 루트에서 아래 명령으로 배포용 포탑을 다시 만든다. 각 파일에는 해당 스킨의 몸체·포신·텍스처와 설치·사격·주행 클립이 들어 있다. 호프 본체와 포탑은 각자의 리그로 재생한다. [이동·사격 판정과 원본 대조](COMBAT-AUDIT.md) · [Google Drive 경기용 GLB 묶음](https://drive.google.com/file/d/1yGBKI1J0qzTk3JqTssk3Kaylpfj0eeRD/view)

```powershell
uv run --no-project --python 3.13 --with bpy==5.3.0 python tools/assets/assemble_turrets.py
```
