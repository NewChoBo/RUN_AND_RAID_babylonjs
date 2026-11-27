# RUN AND RAID · Babylon.js

브라우저에서 실행하는 런앤레이드 전용 프로젝트입니다. 기존 2대2 화물 추격 경기, 영웅 선택, 봇 연습, 터치 조준과 온라인 방 코드를 포함합니다.

[공개 게임](https://newchobo.github.io/RUN_AND_RAID_babylonjs/)에서 **게임시작 → 빠른 매칭**으로 공개 대기실에 들어갑니다. 친구와 플레이할 때는 **사설방 → 방 만들기**로 방 코드를 공유하고, 상대는 **참가하기**에서 코드를 입력합니다. 두 모드 모두 같은 대기실에서 캐릭터를 선택하고 확정합니다. 사설방에 혼자 있으면 연습 외형을 고르고 봇전을 시작할 수 있습니다. 온라인 방을 만들 수 없을 때는 오프라인 봇 연습을 선택할 수 있습니다.

## 실행

Node.js 22.12 이상에서 프로젝트 루트에서 실행합니다.

```sh
npm ci
npm run dev
```

브라우저에서 http://127.0.0.1:5198/ 을 엽니다. 봇 연습은 오프라인으로 실행할 수 있습니다. 온라인 경기는 프로젝트 루트의 `.env.local`에 이 프로젝트의 `VITE_PHOTON_APP_ID`를 설정한 뒤 서버를 다시 시작합니다.

```sh
npm run check
npm test
npm run build
```

## UI 수정

로비 홈, 상점, 경기 대기실, 원작 에셋 화면의 마크업은 `src/ui/templates/`에 있습니다. 공통 상단 메뉴는 `toolbar.html`, 메뉴 아이콘은 `toolbar-icons.html`에서 수정합니다. 화면 동작은 `src/app/`, 스타일은 `src/ui/styles/`, 화면 전환은 `src/routes.ts`에서 관리합니다.

`index.html`에는 시작 화면, 게임 캔버스, 공통 대화상자와 각 템플릿의 위치가 있습니다. 예를 들어 `<!-- ui: shop -->` 위치에 Vite가 `shop.html`을 넣습니다. 개발 서버와 배포 빌드 모두 완성된 HTML을 브라우저에 전달하며, 템플릿 안의 이미지 경로는 `index.html` 기준으로 작성합니다.

## 게임 구현과 에셋

경기 구현은 [기존 웹판의 3fcadc2](https://github.com/NewChoBo/oblivion-archive/tree/3fcadc2)에서 이식했습니다. 게임 규칙은 `src/game/raid`, 영웅별 콘텐츠는 `src/content/raid`, Babylon.js 렌더링은 `src/platform/babylon/raid`에 있습니다. 기본 플레이 모델과 파티클 출처는 [에셋 출처](docs/ASSETS.md)에 기록했습니다.

개발진 제공 Player.zip의 전체 변환과 원작 모션 준비 절차는 [Player 에셋 준비](docs/PLAYER-ASSETS.md)에 있습니다.

원본을 준비하면 [에셋 열람 화면](http://127.0.0.1:5198/#/assets)에서 캐릭터나 파일명으로 찾아 모델을 회전하고 변환 파일을 내려받을 수 있습니다.

공개 플레이판 배포, Photon 연결 검증, 이어서 지킬 전투 규칙은 [전용 프로젝트 인계 가이드](docs/HANDOFF.md)에 정리했습니다.
