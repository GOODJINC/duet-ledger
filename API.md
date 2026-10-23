# 듀엣 가계부 API 사용 안내

앱 비밀번호로 선택한 계좌의 조회·검색·통계·입력·수정·휴지통 이동·영수증을 연동합니다. API는 기존 Docker 서비스 안에서 동작합니다. 별도 컨테이너나 MCP 서버는 필요하지 않습니다.

**추가·수정 요청은 바로 저장됩니다.** 삭제 권한을 허용한 키는 거래를 휴지통으로 옮기고 복구할 수 있습니다. 영구 삭제·가계부/계좌 생성·공유 변경·서버 관리는 외부 API로 제공하지 않습니다.

## 1. 관리자와 사용자 설정

1. 관리자로 로그인해 사용자 이름 → **관리 → 외부 API → API 사용 허용**을 켭니다. 초기값은 꺼짐입니다.
2. 각 사용자는 사용자 이름 → **계정 설정 → API 앱 비밀번호 → 관리**를 엽니다.
3. ‘앱 비밀번호 만들기’에서 연결 이름, 접근할 계좌, 기능 권한, 유효기간을 선택합니다.
4. 현재 비밀번호로 확인합니다. 2단계 인증을 사용하면 인증 코드 또는 복구 코드도 필요합니다.
5. 생성된 앱 비밀번호를 복사해 보관합니다. **한 번만 표시하며 나중에 다시 확인할 수 없습니다.** 잃어버리면 폐기하고 새로 만듭니다.

유효기간은 30일·90일·1년(365일)·만료 없음이며 기본값은 90일입니다. 언제든 본인이 폐기할 수 있습니다. 관리자가 API를 끄면 기존 키도 즉시 차단되지만 폐기되지는 않습니다. 다시 켜면 만료·폐기되지 않은 키는 다시 사용할 수 있습니다.

선택한 계좌만 허용하고 나중에 추가한 계좌는 포함하지 않습니다. 공유받은 조회 전용 계좌는 쓰기 권한을 골라도 변경할 수 없습니다. 공유를 해제하면 다음 요청부터 접근이 차단됩니다. 사용자당 활성 앱 비밀번호는 최대 100개입니다. 이체의 추가·수정·삭제·복구에는 양쪽 계좌의 선택과 편집 권한이 필요합니다.

비밀번호 변경·서버 비밀번호 재설정·2단계 인증 설정 변경·모든 기기 로그아웃·운영 백업 복원 시 앱 비밀번호를 폐기합니다. 보안 설정을 바꾸거나 백업을 복원한 뒤에는 필요한 키를 다시 발급하세요.

## 2. 연결 정보 보관

CLI를 실행하는 PC에서 서버 주소에 접근할 수 있어야 합니다. 같은 홈서버 또는 Tailscale 연결을 사용할 수 있습니다. 인터넷에 공개할 때는 HTTPS와 적절한 접속 제한을 설정하세요. 앱 비밀번호를 주소·프롬프트·Git 저장소·스크린샷에 넣지 마세요.

Fedora 등 Bash 환경에서 아래 명령을 실행한 뒤 복사한 앱 비밀번호를 붙여넣습니다. 입력 내용은 화면에 표시되지 않습니다.

```bash
mkdir -p "$HOME/.config/duet-ledger"
(umask 077; read -rs -p '앱 비밀번호를 붙여넣고 Enter: ' duet_app_password; printf '%s' "$duet_app_password" > "$HOME/.config/duet-ledger/app-password")
export DUET_LEDGER_URL='http://127.0.0.1:18088'
export DUET_LEDGER_APP_PASSWORD_FILE="$HOME/.config/duet-ledger/app-password"
```

서버 주소는 설치 환경에 맞게 바꿉니다. 비밀번호 파일은 소유자만 읽고 쓸 수 있어야 합니다(`chmod 600 파일`). 환경변수 `DUET_LEDGER_APP_PASSWORD`로 직접 전달하는 방식도 지원하지만 파일 방식을 권고합니다. CLI 도구가 다른 환경에서 실행되면 그 환경에도 서버 주소와 파일 경로를 설정해야 합니다.

## 3. Python 호출 도구

Python 3 표준 기능만 사용합니다. 프로젝트 폴더에서 다음과 같이 실행합니다.

```bash
python3 scripts/duet_api.py accounts
python3 scripts/duet_api.py transactions --from 2026-10-01 --to 2026-10-31
python3 scripts/duet_api.py statistics --from 2026-10-01 --to 2026-10-31
python3 scripts/duet_api.py categories --account 계좌ID --kind expense
```

`accounts` 결과에서 계좌 ID와 통화를 확인합니다. 예를 들어 거래 입력 파일 `expense.json`은 다음 형식입니다. 계좌 ID를 실제 값으로 바꾸세요. 실제 금융 자료가 들어간 입력 파일은 Git 저장소 밖의 개인 폴더에 보관하세요.

```json
{
  "account_id": "계좌ID",
  "kind": "expense",
  "date": "2026-10-23",
  "time": "12:30",
  "timezone": "Asia/Seoul",
  "amount": "12000",
  "title": "점심",
  "category": "food",
  "note": ""
}
```

```bash
python3 scripts/duet_api.py add --json expense.json --request-id lunch-20261023-001
python3 scripts/duet_api.py get 내역ID
```

통신이 끊겨 저장 여부가 불명확하면 **동일한 request-id와 동일한 JSON으로 재시도**합니다. 별개의 새 거래에는 새로운 request-id를 사용합니다. 다른 연결 키와는 요청 식별자를 공유하지 않습니다. AI나 호출 프로그램도 이 규칙을 지켜야 중복을 방지할 수 있습니다.

수정은 최신 거래의 `version`을 확인하고 전체 입력값에 포함합니다. 내용·분류·메모·통화 등 기존에 유지할 값도 함께 보냅니다. 외화 결제는 원금액·환율 필드도 유지하세요.

```bash
python3 scripts/duet_api.py update 내역ID --json edited-expense.json
python3 scripts/duet_api.py delete 내역ID --version 2
python3 scripts/duet_api.py restore 내역ID --version 3
python3 scripts/duet_api.py attach 내역ID /경로/receipt.jpg
python3 scripts/duet_api.py receipt 영수증ID --output receipt-download.jpg
python3 scripts/duet_api.py detach-receipt 영수증ID
```

위 버전 숫자는 예시입니다. 항상 현재 값을 사용하세요. 삭제·복구도 거래 버전을 1씩 올립니다. 다운로드는 기존 파일을 덮어쓰지 않습니다. 영수증은 JPG·PNG 5MB/1,600만 화소 이하이며 서버에서 정규화합니다. 영수증 첨부 해제는 거래 휴지통 복구와 별개이며 별도의 복구 API는 없습니다.

## 4. 직접 HTTP로 호출하기

외부 연동 주소는 **`/api/v1`**입니다. 웹 로그인 쿠키 대신 아래 헤더를 사용합니다. 앱 비밀번호를 일반 계정 비밀번호처럼 Basic 인증에 넣거나 URL에 붙이지 마세요.

```http
Authorization: Bearer dl_app_발급받은값
Content-Type: application/json
```

| 경로 (`/api/v1` 뒤) | 메서드 | 필요한 권한 |
| --- | --- | --- |
| `/me` | GET | 유효한 앱 비밀번호. 기본 연결 정보만 반환 |
| `/accounts` | GET | read |
| `/categories?account=계좌ID&kind=expense` | GET | read |
| `/transactions` | GET | read |
| `/transactions/{id}` | GET | read |
| `/statistics` | GET | read |
| `/transactions` | POST | create + `Idempotency-Key` 헤더 |
| `/transactions/{id}` | PUT | update + JSON `version` |
| `/transactions/{id}` | DELETE | delete + JSON `version` (휴지통 이동) |
| `/transactions/{id}/restore` | POST | delete + JSON `version` |
| `/transactions/{id}/receipts` | POST | receipts + multipart의 `file` |
| `/receipts/{id}` | GET | read |
| `/receipts/{id}` | DELETE | delete와 receipts 모두 |

모든 기능은 현재 사용자 권한과 계좌 선택 범위를 추가로 검사합니다. 앱 비밀번호가 관리자 소유여도 서버 관리 권한은 주지 않습니다. 기능 권한은 각각 독립적이며 쓰기 키에도 read를 함께 허용하면 최신 버전·계좌·분류를 쉽게 확인할 수 있습니다.

조회 조건: `from`, `to`, `account`, `ledger`, `scope=all/private/shared`, `currency`, `display_currency`, `type`, `search`, `trash=true`, `page`, `page_size`. `page_size`는 1~200이며 기본값은 50입니다. 날짜를 생략하면 사용자 시간대의 이번 달을 조회합니다. 통계는 페이지에 표시한 일부가 아닌 허용된 전체 조회 범위 기준입니다. 날짜는 `YYYY-MM-DD`, 시간은 `HH:mm`입니다.

**금액은 최소 화폐 단위의 정수 문자열**입니다. `"12000"`은 12,000원, USD 계좌의 `"1234"`는 12.34달러입니다. 소수형 숫자로 보내지 마세요. 기본 통화 환산은 `display_currency=KRW`처럼 지정하며 환율 없는 통화는 합계에서 제외합니다. 외화 입력은 `original_currency`, `original_amount`, `exchange_rate`를 사용할 수 있고 `amount`는 환산한 계좌 반영액이어야 합니다. 같은 통화 계좌 간 이체는 `kind=transfer`, `account_id`, `to_id`를 사용하고 분류는 `transfer`로 지정합니다.

한 번의 조회는 최대 4만 개 계좌별 증감까지 지원합니다. 범위를 초과하면 기간이나 계좌를 좁혀야 하며 결과를 조용히 잘라 계산하지 않습니다.

## 5. 오류와 작업 기록

- `400`: 입력·금액·날짜·요청 식별자 형식 확인
- `401`: 앱 비밀번호가 틀렸거나 만료·폐기됨
- `403`: API 사용 중지 또는 기능·현재 공유 권한 부족
- `404`: 허용된 범위에서 찾을 수 없음
- `409`: 거래 버전 충돌 또는 같은 요청 식별자로 다른 내용 전송
- `429`: 호출 제한. 키마다 분당 120회이며 `Retry-After` 이후 재시도

계정 설정의 앱 비밀번호 창에서 마지막 사용 시각과 최근 API 사용 기록 100건을 확인합니다. 서버는 사용자별 최근 1,000건을 유지합니다. 연결 이름·메서드·경로 형식·상태만 보관하고 앱 비밀번호·본문·검색어는 기록하지 않습니다. 실제 금융 변경 이력에는 사용한 연결 키 식별자가 남습니다.

현재 API는 브라우저의 다른 사이트에서 자유롭게 호출하는 공개 CORS를 제공하지 않습니다. 로컬 CLI·서버 자동화에서 호출할 수 있습니다. 키 발급·폐기·관리 설정은 웹 로그인에서만 가능하고 API 키로 다시 키를 발급하거나 권한을 넓힐 수 없습니다.

OpenAPI 명세는 서버의 `/openapi.json`에서 확인합니다. CLI용 연동 규칙은 [integrations/CLI.md](integrations/CLI.md)를 참고하세요. Codex CLI용 MCP 서버는 같은 포트의 `/mcp`에 제공됩니다. [MCP 연결 안내](MCP.md)를 참고하세요.

## MCP 직접 연결

동일한 관리자 허용·앱 비밀번호·계좌/기능 권한으로 홈서버의 `/mcp`에 연결할 수 있습니다. [MCP 안내](MCP.md)를 확인하세요.
