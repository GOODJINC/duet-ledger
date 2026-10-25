# 설치

[매뉴얼 홈](index.md) · [운영](operations.md)

## 준비

Docker Engine·Compose 플러그인 또는 Arcane이 필요합니다. 이미지는 AMD64·ARM64를 지원하며 Docker가 서버에 맞는 이미지를 선택합니다.

## Arcane

1. 새 스택에 [compose.arcane.yaml](https://github.com/GOODJINC/duet-ledger/blob/main/compose.arcane.yaml)을 붙여넣습니다.
2. 필요하면 이미지 버전과 호스트 포트를 바꾼 뒤 배포합니다.
3. `http://서버IP:18088`에서 첫 계정을 만듭니다. **첫 계정이 관리자**가 됩니다.

이 파일은 기본적으로 모든 서버 네트워크(`0.0.0.0`)에 포트를 엽니다. 신뢰하는 네트워크에서 먼저 계정을 만드세요.

## Docker Compose

서버에서 실행합니다.

```bash
mkdir -p duet-ledger
cd duet-ledger
curl -fL https://raw.githubusercontent.com/GOODJINC/duet-ledger/main/compose.yaml -o compose.yaml
docker compose up -d
docker compose ps
```

`http://localhost:18088`에서 첫 계정을 만듭니다. 이 파일은 기본적으로 서버 내부(`127.0.0.1`)에서만 접속할 수 있습니다.

## 접속 주소와 포트

Compose 파일 옆의 `.env` 또는 Arcane의 환경변수에 필요한 값을 설정합니다.

| 변수                        | 용도                                        |
| --------------------------- | ------------------------------------------- |
| `DUET_LEDGER_IMAGE`         | 이미지와 버전. 기본값은 Compose의 지정 버전 |
| `DUET_LEDGER_BIND`          | 접속을 받을 서버 주소                       |
| `DUET_LEDGER_PORT`          | 호스트 포트. 기본18088                      |
| `DUET_LEDGER_PUBLIC_URL`    | HTTPS 접속 주소                             |
| `DUET_LEDGER_SECURE_COOKIE` | HTTPS 운영 시 `true`                        |

다른 PC에서 포트18888로 접속하는 예시:

```dotenv
DUET_LEDGER_BIND=0.0.0.0
DUET_LEDGER_PORT=18888
```

변경 후 `docker compose up -d` 또는 Arcane 재배포를 실행하고 `http://서버IP:18888`로 접속합니다. 방화벽에서도 포트 접근이 허용되어야 합니다. 특정 네트워크에만 열려면 `DUET_LEDGER_BIND`에 서버의 해당 IP를 지정하세요. 컨테이너 내부 포트8080은 유지합니다.

## HTTPS와 PWA

인터넷에 공개할 때는 신뢰할 수 있는 인증서를 사용하는 역방향 프록시로 HTTPS를 구성합니다. 앱을 도메인의 루트 경로에 연결하고 원래 `Host`와 `/api/`, `/mcp` 요청을 전달하세요.

```dotenv
DUET_LEDGER_PUBLIC_URL=https://ledger.example.com
DUET_LEDGER_SECURE_COOKIE=true
```

`PUBLIC_URL`은 경로와 끝의 `/` 없는 실제 접속 주소입니다. HTTPS 준비 전에 보안 쿠키를 켜면 HTTP 로그인이 유지되지 않을 수 있습니다.

PWA 설치는 신뢰할 수 있는 HTTPS 주소로 접속한 뒤 브라우저의 앱 설치 메뉴를 사용합니다. VPN으로 연결해도 주소가 일반 HTTP이면 설치가 제한될 수 있습니다. 오프라인 거래 입력은 지원하지 않습니다.

## 저장 자료

자료는 `duet-ledger-data` 볼륨에 보관하며 컨테이너 교체 후에도 유지됩니다. **볼륨을 삭제하면 자료를 잃을 수 있습니다.** 업데이트·백업·복원은 [운영 안내](operations.md)를 따르세요.
