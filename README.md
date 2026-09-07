# Lost Ark Discord Bot

로스트아크 길드/공대 운영을 돕기 위해 만든 TypeScript 기반 Discord 봇입니다.

떠돌이 상인 카드 확인, 숙제 체크, 아비도스 제작 계산, 파티 모집, 원정대 조회, TTS 같은 반복 작업을 슬래시 명령어로 처리합니다.

## 한눈에 보기

| 항목 | 내용 |
| --- | --- |
| 한국어 프로젝트명 | 로스트아크 디스코드 봇 |
| 저장소 성격 | Discord slash command 기반 게임 커뮤니티 운영 봇 |
| 실행 형태 | Node.js 22 + TypeScript |
| 명령어 배포 | Discord application command 등록 |
| 상태 저장 | `data/*.json` 로컬 파일 기반 |
| 음성 기능 | `@discordjs/voice`, ffmpeg, Google TTS API 사용 |

## 봇 사용 흐름

1. Discord Developer Portal에서 애플리케이션과 봇을 생성합니다.
2. 봇 토큰, 애플리케이션 Client ID, 테스트 Guild ID를 `.env`에 입력합니다.
3. 봇을 서버에 초대할 때 slash command, message, voice 관련 권한을 부여합니다.
4. `npm run deploy:commands`로 길드 slash command를 등록합니다.
5. `npm run dev` 또는 `npm start`로 봇을 실행합니다.
6. Discord 서버에서 `/ping`으로 응답을 확인한 뒤 필요한 기능을 사용합니다.

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

## 환경변수

| 변수 | 설명 |
| --- | --- |
| `DISCORD_TOKEN` | Discord Bot Token입니다. 절대 공개하지 않습니다. |
| `DISCORD_CLIENT_ID` | Discord Application Client ID입니다. |
| `DISCORD_GUILD_ID` | 개발 중 slash command를 빠르게 등록할 테스트 서버 ID입니다. |

## 주요 명령어 설명

| 명령어 | 용도 |
| --- | --- |
| `/merchant` | 떠돌이 상인 카드 확인, 서버별 등록, 알림 설정, kloa.gg 동기화 |
| `/homework` | 캐릭터별 숙제 상태 등록과 확인 |
| `/abidos` | 제작 재료/결과 계산 보조 |
| `/party` | 채널 안에서 파티 모집 패널 생성과 관리 |
| `/roster` | 원정대/캐릭터 정보 조회와 동기화 |
| `/tts` | 음성 채널에서 문장을 TTS로 재생 |

## 구현 포인트

- 기능별 폴더를 분리해 명령어, 서비스, 타입, 데이터를 함께 관리합니다.
- Discord 슬래시 명령어 배포와 봇 실행을 분리해 운영 중 명령어 갱신 흐름을 명확히 했습니다.
- 로컬 JSON 파일을 사용해 작은 서버에서도 상태를 유지할 수 있게 구성했습니다.
- TTS 기능은 음성 채널 참가, 음성 생성, 재생, 퇴장을 별도 서비스로 분리했습니다.

## 운영 메모

- `data/*.json`은 서버별 알림 설정, 모집 상태, 숙제 상태 같은 운영 데이터가 쌓이는 위치입니다.
- 저장소에는 실제 운영 JSON을 올리지 않는 것을 권장합니다. 필요한 경우 샘플 JSON만 별도 작성합니다.
- 음성 TTS 기능은 봇이 음성 채널에 접속할 수 있는 권한과 서버의 음성 연결 상태에 영향을 받습니다.
- slash command가 보이지 않으면 `DISCORD_GUILD_ID`가 맞는지, 봇이 해당 서버에 초대되어 있는지 먼저 확인합니다.

## 검증

```bash
npm run build
```

명령어 등록까지 확인하려면 Discord 테스트 서버를 준비한 뒤:

```bash
npm run deploy:commands
```

## GitHub 업로드 전 주의

- `.env`의 Discord Bot Token, Client ID, Guild ID는 공개하지 않습니다.
- `data/*.json`은 실제 서버/사용자 상태가 들어갈 수 있으므로 샘플이 아니라면 커밋하지 않습니다.
- `node_modules`, `dist`, 로그 파일은 업로드 대상에서 제외합니다.
