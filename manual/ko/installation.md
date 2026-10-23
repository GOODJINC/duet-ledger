# 설치

[매뉴얼 홈](index.md) · [운영·백업](operations.md)

## 준비와 실행

Linux 서버의 Docker Engine·Compose 플러그인 또는 Arcane이 필요합니다. 공개 이미지를 사용하므로 Git·Go·Node.js는 필요하지 않습니다. 첫 게시가 끝나지 않은 버전은 내려받을 수 없으므로 [Packages](https://github.com/GOODJINC/duet-ledger/pkgs/container/duet-ledger)에서 태그를 확인하세요.

### Arcane

1. 새 스택을 만들고 [Arcane용 Compose 원본](https://github.com/GOODJINC/duet-ledger/blob/main/compose.arcane.yaml)을 붙여넣습니다.
2. 필요하면 이미지 태그와 호스트 포트를 수정하고 배포합니다. 추가 파일이나 빌드 경로는 필요하지 않습니다.
3. `http://서버IP:18088`에 접속해 첫 계정을 만듭니다. **첫 계정이 관리자**이며 개인 가계부가 생깁니다.

Arcane용 파일의 기본 바인딩은 `0.0.0.0`입니다. 서버 네트워크에서 접근할 수 있으므로 신뢰하는 네트워크에서 먼저 계정을 만들고, 공개 인터넷 연결에는 HTTPS를 적용하세요. CLI용 기본 Compose는 `127.0.0.1`이며 아래 방법으로 접속 범위를 바꿀 수 있습니다.

### Docker Compose

아래 명령은 설치 폴더와 Compose 파일 하나만 준비합니다.

```bash
mkdir -p duet-ledger
cd duet-ledger
curl -fL https://raw.githubusercontent.com/GOODJINC/duet-ledger/main/compose.yaml -o compose.yaml
docker compose up -d
docker compose ps
```

서버에서 `http://localhost:18088`을 엽니다. 앱 컨테이너 하나와 SQLite를 사용하며 별도 DB·Redis·MCP 서비스는 필요하지 않습니다. 지원 이미지는 AMD64·ARM64이며 Docker가 맞는 이미지를 고릅니다.

## 포트와 다른 PC 접속

기본 설정은 `127.0.0.1:18088`입니다. Compose가 있는 폴더에서 `.env`를 만들거나 Arcane의 환경변수를 설정합니다. `.env`는 선택 사항이며 아래 값만 직접 넣어도 됩니다.

```bash
touch .env
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
