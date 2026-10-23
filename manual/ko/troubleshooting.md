# 문제 해결·지원

[매뉴얼 홈](index.md)

| 문제 | 먼저 확인할 것 |
| --- | --- |
| 다른 PC에서 접속 안 됨 | 기본은127.0.0.1 바인딩. `.env`의 주소·포트, Compose 재생성, 방화벽·Tailscale 연결 확인 |
| `no configuration file provided` | Compose 파일이 있는 폴더에서 실행하거나 `-f /실제경로/compose.yaml` 지정 |
| 첫 설치 화면이 다시 나타남 | 새 계정을 만들기 전에 기존 볼륨과 `DUET_LEDGER_DATA_DIR`이 맞는지 확인. 빈 자료 위치에 연결했을 수 있음 |
| 포트 사용 중 오류 | 호스트 포트를 변경하고 다시 생성 |
| HTTPS 설정 후 로그인 안 됨 | 실제 접속 주소와 `PUBLIC_URL`, 프록시 Host 보존, HTTPS와 SECURE_COOKIE 조합 확인 |
| 앱 설치 안 됨 | 신뢰할 수 있는 HTTPS 주소로 접속. 일반 HTTP·Tailscale HTTP에서는 설치 제한 가능 |
| 공유 초대를 수락했는데 안 보임 | 자료 소유자의 최종 승인 필요. 다른 계정으로 수락하지 않았는지 확인 |
| 공유를 껐는데 아직 보임 | 계좌 직접 공유·가계부 멤버십 등 다른 접근 경로 확인 |
| 기본 통화를 바꿔도 계좌 통화가 그대로 | 정상. 기존 계좌와 금액은 바꾸지 않음. 입력 기본 계좌와 보조 통화·환율 별도 설정 |
| 사진 선택에 갤러리가 안 보임 | 기기·브라우저 선택기 차이. 파일·사진 메뉴 사용, HEIC는 JPG/PNG로 변환 |
| 화면이 사용자 CSS 때문에 깨짐 | `/admin?safe-theme=1`로 접속해 공통 CSS·글꼴 해제 |
| API에 Idempotency-Key 오류 | Postman **Headers**에 추가하고 왼쪽 체크박스 활성화. Body·Params는 아님 |
| MCP 환경변수 오류 | 앱 비밀번호 입력·export 후 같은 터미널에서 Codex 재실행 |

## 지원을 요청할 때

[GitHub Issues](https://github.com/GOODJINC/duet-ledger/issues)에 앱 버전, 설치 방식, OS·브라우저, 문제 재현 순서, 예상한 결과와 실제 결과를 적어 주세요. 모바일 문제는 화면 크기·글씨 배율도 도움이 됩니다.

**비밀번호·앱 비밀번호·쿠키·백업·master.key·실제 금융 자료는 올리지 마세요.** 화면과 로그는 개인 내용을 가린 뒤 공유합니다. 보안 문제는 공개 이슈에 상세 공격 방법을 올리기 전에 [저장소 보안 안내](https://github.com/GOODJINC/duet-ledger/blob/main/SECURITY.md)를 확인하세요.

버전 변경 사항은 [CHANGELOG](https://github.com/GOODJINC/duet-ledger/blob/main/CHANGELOG.md), 키 권한·오류는 [API](api.md), AI 연결은 [MCP](mcp.md), 복원·계정 복구는 [운영](operations.md)을 참고합니다.
