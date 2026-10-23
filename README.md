# 듀엣 가계부 · Duet Ledger

[English](README.en.md) · [사용 설명서](manual/ko/index.md) · [변경 기록](CHANGELOG.md)

개인 가계부와 공유 가계부를 함께 사용할 수 있는 셀프호스팅 가계부입니다.
혼자 쓰거나 가족·부부·커플과 함께 쓰고, 개인 가계부의 특정 계좌만 공유할 수도 있습니다.

- 사용자마다 여러 가계부와 계좌 관리
- 수입·지출·이체, 검색, 달력, 통계와 영수증 첨부
- 계좌별 공유와 조회자·편집자 권한
- 여러 통화와 직접 설정하는 환율
- 한국어·영어, 반응형 웹과 PWA
- 앱 비밀번호로 계좌·권한을 제한하는 REST API와 MCP
- Docker 컨테이너 하나와 SQLite로 운영

현재는 **정식 출시 전 개발 버전**입니다. 중요한 자료를 입력하기 전에 소량의 기록으로 시험하고 백업을 준비하세요.

## 빠른 시작

Docker Engine과 Docker Compose 플러그인, Git이 필요합니다.

```bash
git clone https://github.com/GOODJINC/duet-ledger.git
cd duet-ledger
docker compose up -d --build
```

서버에서 **http://localhost:18088**을 열고 첫 계정을 만듭니다. **첫 계정이 관리자**가 됩니다. 초기 토큰은 필요하지 않습니다.
기본적으로 서버 자체에서만 접속할 수 있습니다. 다른 PC 접속·포트 변경·HTTPS는 [설치 안내](manual/ko/installation.md)를 확인하세요.

## 매뉴얼

| 하고 싶은 일 | 안내 |
| --- | --- |
| 설치·다른 기기 접속·HTTPS | [설치](manual/ko/installation.md) |
| 계좌 만들기·거래 입력·공유·환율 | [사용법](manual/ko/usage.md) |
| 업데이트·백업·복원·로그인 복구 | [운영](manual/ko/operations.md) |
| Postman·거래 입력·검색·통계·영수증 | [API](manual/ko/api.md) |
| Codex CLI에서 홈서버 직접 연결 | [MCP](manual/ko/mcp.md) |
| 접속·권한·설치 문제 | [문제 해결](manual/ko/troubleshooting.md) |

앱의 사용자 메뉴 → **도움말 및 지원**에서도 같은 매뉴얼을 볼 수 있습니다. 매뉴얼은 앱에 포함되며 별도 문서 서버가 필요하지 않습니다.

## 자료 보관

계정·거래·영수증은 `duet-ledger-data` Docker 볼륨에 저장합니다. 컨테이너를 교체해도 유지됩니다.
**`docker compose down -v`는 자료를 삭제할 수 있습니다.**

관리자의 운영 백업에는 모든 사용자의 비공개 자료와 사진이 포함됩니다. ZIP은 암호화되지 않으며 `/data/master.key`는 포함되지 않습니다. 백업 ZIP과 원래 키를 별도로 안전하게 보관하세요. [백업·복원 안내](manual/ko/operations.md#백업과-복원)

## 지원과 기여

오류·기능 제안은 [GitHub Issues](https://github.com/GOODJINC/duet-ledger/issues)에 남겨 주세요. 비밀번호·앱 비밀번호·백업·실제 금융 자료를 첨부하지 마세요.
번역·문서·개발 기여는 [기여 안내](CONTRIBUTING.md)를 참고하세요. 취약점 제보는 [보안 안내](SECURITY.md)를 따릅니다.

[AGPL-3.0-only](LICENSE) · [서드파티 라이선스](web/public/third-party-licenses.txt)
