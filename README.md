# RUN AND RAID · Babylon.js

브라우저에서 실행하는 런앤레이드 전용 프로젝트입니다. 기존 2대2 화물 추격 경기, 영웅 선택, 봇 연습, 터치 조준과 온라인 방 코드를 포함합니다.

[공개 게임](https://newchobo.github.io/RUN_AND_RAID_babylonjs/)에서 **주자 선택**으로 전투 능력을 정하고 **봇 연습 외형**에서 제공 캐릭터나 스킨을 선택할 수 있습니다. 현재 원작 외형은 정적 모델입니다.

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

경기 구현은 [기존 웹판의 3fcadc2](https://github.com/NewChoBo/oblivion-archive/tree/3fcadc2)에서 이식했습니다. 게임 규칙은 `src/game/raid`, 영웅별 콘텐츠는 `src/content/raid`, Babylon.js 렌더링은 `src/platform/babylon/raid`에 있습니다. 기본 플레이 모델과 파티클 출처는 [에셋 출처](docs/ASSETS.md)에 기록했습니다.

개발진 제공 Player.zip의 전체 변환과 원작 모션 준비 절차는 [Player 에셋 준비](docs/PLAYER-ASSETS.md)에 있습니다.

원본을 준비하면 [에셋 열람 화면](http://127.0.0.1:5198/#/assets)에서 캐릭터나 파일명으로 찾아 모델을 회전하고 변환 파일을 내려받을 수 있습니다.

공개 플레이판 배포, Photon 연결 검증, 이어서 지킬 전투 규칙은 [전용 프로젝트 인계 가이드](docs/HANDOFF.md)에 정리했습니다.
