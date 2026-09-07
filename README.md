# Lost Ark Discord Bot

로스트아크 길드/공대 운영을 돕기 위해 만든 TypeScript 기반 Discord 봇입니다.

떠돌이 상인 카드 확인, 숙제 체크, 아비도스 제작 계산, 파티 모집, 원정대 조회, TTS 같은 반복 작업을 슬래시 명령어로 처리합니다.

## 주요 기능

- `/ping`: 봇 응답 상태 확인
- `/merchant`: 떠돌이 상인 카드 목록, 서버별 수동 등록, 감시 채널/역할 설정, 동기화
- `/homework`: 캐릭터별 일일/주간 숙제 확인과 상태 관리
- `/abidos`: 생활 재료와 제작 결과 계산
- `/party`: 디스코드 채널 안에서 파티 모집 패널 관리
- `/roster`: 로스트아크 원정대/캐릭터 정보 조회와 동기화
- `/tts`: 음성 채널에서 한국어/영어/일본어 TTS 재생, 퇴장

## 기술 스택

- Node.js 22
- TypeScript
- discord.js 14
- @discordjs/voice
- google-tts-api
- ffmpeg-static, prism-media, opusscript
- tsx, TypeScript compiler

## 프로젝트 구조

```text
디스코드 봇/
  src/
    commands/              공통 명령어
    features/
      abidos/              아비도스 제작 계산
      homework/            숙제 관리
      merchant/            떠돌이 상인 카드/알림
      party/               파티 모집
      roster/              원정대 조회/동기화
      tts/                 음성 TTS
    config/env.ts          환경변수 검증
    deploy-commands.ts     슬래시 명령어 배포
    index.ts               봇 엔트리포인트
  data/                    로컬 실행 중 생성되는 상태 파일
```

## 실행 방법

```bash
npm install
```

`.env.example`을 기준으로 `.env`를 만듭니다.

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
```

개발 중 빠른 반영을 위해 길드 명령어를 배포합니다.

```bash
npm run deploy:commands
```

개발 실행:

```bash
npm run dev
```

운영 빌드:

```bash
npm run build
npm start
```

## 구현 포인트

- 기능별 폴더를 분리해 명령어, 서비스, 타입, 데이터를 함께 관리합니다.
- Discord 슬래시 명령어 배포와 봇 실행을 분리해 운영 중 명령어 갱신 흐름을 명확히 했습니다.
- 로컬 JSON 파일을 사용해 작은 서버에서도 상태를 유지할 수 있게 구성했습니다.
- TTS 기능은 음성 채널 참가, 음성 생성, 재생, 퇴장을 별도 서비스로 분리했습니다.

## GitHub 업로드 전 주의

- `.env`의 Discord Bot Token, Client ID, Guild ID는 공개하지 않습니다.
- `data/*.json`은 실제 서버/사용자 상태가 들어갈 수 있으므로 샘플이 아니라면 커밋하지 않습니다.
- `node_modules`, `dist`, 로그 파일은 업로드 대상에서 제외합니다.
