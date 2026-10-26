# 듀엣 가계부 · Duet Ledger

[English](README.en.md) · [매뉴얼](manual/ko/index.md) · [변경 기록](CHANGELOG.md)

Docker로 운영하는 개인·공유 가계부입니다. 계정 하나로 여러 가계부를 관리하고, 가계부 전체 또는 필요한 계좌만 공유할 수 있습니다.

- 수입·지출·이체, 검색·달력·통계, 영수증 첨부
- 조회자·편집자 권한, 여러 통화와 환율, 한국어·영어
- 모바일 웹·PWA, REST API·MCP
- 컨테이너 하나와 SQLite, 서버 백업·복원

## 설치

서버에서 다음 명령을 실행하고 `http://localhost:18088`로 접속합니다.

```bash
mkdir -p duet-ledger
cd duet-ledger
curl -fL https://raw.githubusercontent.com/GOODJINC/duet-ledger/main/compose.yaml -o compose.yaml
docker compose up -d
```

Compose 파일의 `${…}`는 실행 시 적용되는 설정입니다. 포트와 접속 주소는 `.env`로 바꿀 수 있습니다.

**첫 계정이 관리자**가 됩니다. 신뢰하는 네트워크에서 계정을 만든 뒤 외부에 공개하세요. 다른 PC 접속·포트·HTTPS 설정은 [설치 안내](manual/ko/installation.md)를 참고하세요.

## 매뉴얼

[설치](manual/ko/installation.md) · [사용법](manual/ko/usage.md) · [업데이트·백업·복원](manual/ko/operations.md) · [API](manual/ko/api.md) · [MCP](manual/ko/mcp.md) · [문제 해결](manual/ko/troubleshooting.md)

앱의 사용자 메뉴 → **도움말 및 지원**에서도 볼 수 있습니다.

## 자료 보관

자료는 `duet-ledger-data` 볼륨에 저장됩니다. **`docker compose down -v`는 자료를 삭제할 수 있습니다.** 운영 백업 ZIP과 원래 `master.key`를 별도로 보관하세요. 중요한 자료는 정기적으로 백업하세요.

[오류·기능 제안](https://github.com/GOODJINC/duet-ledger/issues) · [보안 제보](SECURITY.md) · [기여](CONTRIBUTING.md)

[AGPL-3.0-only](LICENSE) · [서드파티 라이선스](web/public/third-party-licenses.txt)
