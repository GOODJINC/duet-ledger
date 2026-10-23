# 설치

[매뉴얼 홈](index.md) · [운영·백업](operations.md)

## 준비와 실행

Linux 홈서버에 Docker Engine·Compose 플러그인·Git을 준비합니다. Docker 명령을 실행할 권한과 데이터를 보관할 디스크 공간이 필요합니다. 설치 상태는 `docker version`, `docker compose version`으로 확인합니다.

```bash
git clone https://github.com/GOODJINC/duet-ledger.git
cd duet-ledger
docker compose up -d --build
docker compose ps
```

첫 빌드는 인터넷에서 의존성과 기본 이미지를 내려받으므로 시간이 걸립니다. 실행에는 앱 컨테이너 하나만 필요하며 별도 DB·Redis·MCP 컨테이너를 설치하지 않습니다.

서버에서 `http://localhost:18088`을 열고 첫 관리자 계정을 만듭니다. **외부에 공개하기 전에 계정을 만드세요.** 이후 신규 가입은 기본적으로 초대가 필요합니다. 개인 가계부도 자동 생성됩니다.

## 포트와 다른 PC 접속

기본 설정은 `127.0.0.1:18088`입니다. Compose가 있는 폴더에서 `.env.example`을 `.env`로 복사해 수정합니다.

```bash
cp .env.example .env
```

예를 들어 같은 네트워크에 공개하고 외부 포트를 18888로 바꾸려면:

```dotenv
DUET_LEDGER_BIND=0.0.0.0
DUET_LEDGER_PORT=18888
DUET_LEDGER_PUBLIC_URL=
DUET_LEDGER_SECURE_COOKIE=false
```

```bash
docker compose up -d
```

다른 기기에서는 `http://서버IP:18888`로 접속합니다. 서버 방화벽과 네트워크에서도 해당 포트가 허용되어야 합니다. Tailscale을 사용한다면 `DUET_LEDGER_BIND`에 서버의 Tailscale IP를 지정해 그 주소에만 연결할 수도 있습니다. 서버 재부팅 후에도 해당 주소가 준비되어야 합니다.

`0.0.0.0`은 서버의 모든 네트워크에 포트를 엽니다. 인터넷에 직접 노출할 때는 HTTPS를 먼저 구성하세요. 포트 변경은 **콜론 앞의 호스트 포트**를 바꾸는 것으로, 컨테이너 내부 포트 8080은 유지합니다.

## HTTPS와 PWA 설치

도메인과 신뢰할 수 있는 인증서를 제공하는 역방향 프록시를 앱 앞에 둡니다. 프록시는 요청을 앱의 8080 또는 공개한 호스트 포트로 전달합니다. 프록시 배치는 운영 환경에 맞게 선택합니다. 앱은 도메인의 루트 경로에서 제공하세요.

```dotenv
DUET_LEDGER_PUBLIC_URL=https://ledger.example.com
DUET_LEDGER_SECURE_COOKIE=true
```

`PUBLIC_URL`은 경로와 끝의 `/` 없는 실제 HTTPS 접속 주소입니다. 프록시는 원래 `Host`를 보존하고 `/api/`와 `/mcp`도 전달해야 합니다. HTTPS 준비 전에 `SECURE_COOKIE=true`를 켜면 HTTP에서 로그인이 유지되지 않을 수 있습니다.

PWA 설치에는 브라우저가 신뢰하는 HTTPS가 필요합니다. Tailscale로 연결해도 브라우저 주소가 일반 HTTP이면 설치가 제한됩니다. HTTPS로 접속한 뒤 브라우저의 앱 설치 메뉴를 사용하세요. 현재는 오프라인 입력·동기화를 지원하지 않습니다.

## 저장 위치와 명령 실행

자료는 `duet-ledger-data` 볼륨의 SQLite·영수증·키에 보관합니다. 소스 폴더와 다른 위치에 있으며 Git 백업에는 포함되지 않습니다. 같은 자료를 여러 앱 컨테이너가 동시에 열 수 없습니다.

Compose 명령은 `compose.yaml`이 있는 폴더에서 실행하거나 파일 경로를 지정합니다.

```bash
docker compose -f /실제/설치경로/compose.yaml ps
docker logs --tail 100 duet-ledger
```

중지·시작은 `docker compose stop`, `docker compose start`입니다. 상태 확인은 `docker compose ps`와 `/healthz`를 사용합니다. 실행 중인 볼륨을 삭제하거나 빈 볼륨으로 바꾸지 마세요.
