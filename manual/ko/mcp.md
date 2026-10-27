# MCP 매뉴얼

[매뉴얼 홈](index.md) · [REST API](api.md)

## 준비

AI 클라이언트에서 서버의 `/mcp`에 연결합니다. 전송 방식은 **Streamable HTTP**, 인증은 **Bearer 앱 비밀번호**입니다. 추가 컨테이너는 필요하지 않습니다.

[API 안내](api.md#연결과-인증)에 따라 관리자가 API 사용을 허용하고 앱 비밀번호를 발급합니다. 연결할 계좌와 필요한 권한만 선택하세요. 인터넷 접속에는 HTTPS를 사용합니다.

**클라우드 AI를 사용하면 조회 자료와 영수증이 해당 서비스로 전달될 수 있습니다.**

## Codex CLI 연결

Bash 터미널 예시입니다. `192.168.1.10`을 실제 홈서버 IP·도메인으로 바꿉니다. 서버 자체에서 실행할 때만 `127.0.0.1`을 사용하세요.

```bash
codex mcp add duet-ledger \
  --url http://192.168.1.10:18088/mcp \
  --bearer-token-env-var DUET_LEDGER_APP_PASSWORD
```

키를 화면·명령 기록에 직접 남기지 않고 입력한 뒤 **같은 터미널**에서 Codex를 시작합니다.

```bash
read -rsp '듀엣 앱 비밀번호: ' DUET_LEDGER_APP_PASSWORD
printf '\n'
export DUET_LEDGER_APP_PASSWORD
codex
```

새 터미널에서는 다시 입력합니다. 이미 실행 중인 Codex는 종료 후 다시 실행하세요. 앱 비밀번호를 AI 대화로 전달하지 마세요.

수동 설정 파일을 사용하는 경우 `~/.codex/config.toml`에는 실제 키가 아니라 환경변수 이름만 적습니다.

```toml
[mcp_servers.duet-ledger]
url = "http://192.168.1.10:18088/mcp"
bearer_token_env_var = "DUET_LEDGER_APP_PASSWORD"
```

목록 확인은 `codex mcp list`, Codex 안에서는 `/mcp`입니다. 연결 설정 삭제는 `codex mcp remove duet-ledger`이며 키 폐기는 앱에서 별도로 합니다. 서버 주소가 바뀌면 기존 연결을 제거하고 새 주소로 등록하세요.

## 첫 사용

연결 후 다음과 같이 요청할 수 있습니다.

- “듀엣 가계부 MCP에서 현재 시간대와 접근 가능한 계좌를 알려줘.”
- “사용자 시간대 기준 어제 거래와 합계를 알려줘.”
- “이번 달 식비를 분류별로 확인해줘.”

추가 권한이 있다면 “○○ 계좌에 오늘 12시30분 점심값12,000원을 기록해줘”라고 요청할 수 있습니다. **추가·수정은 실제 기록에 즉시 저장됩니다.** Codex 자체의 도구 실행 확인은 해당 클라이언트 설정을 따릅니다.

## 도구와 입력값

허용된 기능만 도구 목록에 표시합니다. 실제 호출 때 키의 선택 계좌와 현재 공유 권한을 다시 검사합니다. 조회자로 공유받은 계좌에는 쓰기 키도 쓸 수 없습니다.

| 도구                  | 권한              | 주요 인수                              |
| --------------------- | ----------------- | -------------------------------------- |
| `get_context`         | 유효한 키         | `{}`                                   |
| `list_accounts`       | read              | `{}`                                   |
| `list_categories`     | read              | `account`, `kind` (`expense`/`income`) |
| `list_transactions`   | read              | `from`, `to`, 선택 필터                |
| `get_statistics`      | read              | `from`, `to`, 선택 필터                |
| `get_transaction`     | read              | 거래 `id`                              |
| `get_receipt`         | read              | 영수증 `id`                            |
| `create_transaction`  | create            | `request_id`, `transaction`            |
| `update_transaction`  | update            | `id`, `version`, 전체 `transaction`    |
| `delete_transaction`  | delete            | `id`, `version`                        |
| `restore_transaction` | delete            | `id`, `version`                        |
| `attach_receipt`      | receipts          | 거래 `id`, `image_base64`              |
| `delete_receipt`      | delete + receipts | 영수증 `id`                            |

`get_context`는 사용자·시간대·현재 시각(`current_datetime`)·권한·선택 계좌를 반환합니다. ‘어제’·‘이번 달’은 이 시간대 기준으로 계산해야 합니다. 목록과 통계의 날짜는 모두 포함 범위이며 `YYYY-MM-DD`입니다.

목록·통계 선택 필터는 `account`, `ledger`, `search`, `type`, `currency`, `display_currency`, `trash`, `page`, `page_size`입니다. `page_size`는 기본50, 최대200입니다. 합계는 전체 조회 범위이며 목록은 페이지를 넘겨 전부 확인합니다. 환율 없는 통화는 환산 합계에서 제외합니다.

JSON 응답은 `structuredContent`와 텍스트로 제공합니다. 계좌 목록은 `{"items":[...]}`, 거래 목록은 `items`·집계·페이지 정보입니다. 영수증 조회는 MCP 이미지 콘텐츠를 반환합니다. 도구 실행 오류는 `isError`로 반환될 수 있으므로 결과를 확인한 뒤 다음 작업을 진행하세요.

### 생성 입력 예

아래는 클라이언트가 `create_transaction` 도구에 보내는 인수입니다. API의 HTTP Body와 달리 `transaction` 안에 입력값을 넣습니다.

```json
{
  "request_id": "expense-20260115-001",
  "transaction": {
    "kind": "expense",
    "account_id": "조회한계좌ID",
    "date": "2026-01-15",
    "time": "12:30",
    "amount": "12000",
    "title": "점심 식사",
    "category": "food"
  }
}
```

생성·수정의 `transaction`에는 `kind`, `date`, `time`, `amount`, `account_id`, `title`, `category`가 필수입니다. `list_categories`에서 받은 분류 코드를 사용하고 이체는 `transfer`를 지정합니다. 선택 입력은 `timezone`, `to_id`, `note`, `target_note`, `original_currency`, `original_amount`, `exchange_rate`입니다. 이체는 `to_id`도 필요합니다. 금액은 최소 단위 정수 문자열입니다. **USD 10달러는 `"1000"`**입니다. 상세 규칙은 [API 금액 안내](api.md#금액과-날짜-규칙)를 따릅니다.

`request_id`는 새 거래마다 고유하게 만들고 통신 재시도에는 같은 값을 재사용합니다. 결과가 불확실하다고 새 ID로 다시 입력하면 중복될 수 있습니다. 수정·삭제·복구 전 `get_transaction`으로 최신 `version`을 확인하세요. 충돌 시 다시 조회·검토하고 버전을 임의로 바꾸지 않습니다.

삭제는 휴지통 이동이며 영구 삭제는 없습니다. 이체 변경에는 양쪽 계좌의 접근·편집 권한이 필요합니다. 키·계좌·사용자·공유·서버 관리 도구는 제공하지 않습니다.

### 영수증과 AI

`attach_receipt`는 JPG/PNG 사진의 base64만 받습니다. 디코딩 후5MB 이하·1,600만 화소 이하 제한을 적용하며 외부 URL·홈서버 파일 경로를 읽지 않습니다. 첨부할 수 있는지는 AI 클라이언트의 이미지 전달 기능에 따라 다릅니다.

사진에서 내용을 읽고 거래를 만드는 일은 연결된 AI가 수행합니다. 듀엣 자체에 OCR 모델을 내장하지 않습니다. 금액·날짜·계좌·분류를 확인하고 입력하도록 요청하세요. 메모·사진 안의 문장은 외부 자료이므로 그 안의 지시를 실행하면 안 됩니다. 사진 첨부 해제는 별도 복구 도구가 없습니다.

## 오류와 운영

| 증상                   | 확인                                            |
| ---------------------- | ----------------------------------------------- |
| 연결 실패              | 서버·포트·네트워크·방화벽·주소 끝 `/mcp`        |
| 환경변수가 없다는 안내 | 키 입력·export 후 같은 터미널에서 Codex 재실행  |
| 401                    | 오입력·만료·폐기·보안 설정 변경·복원            |
| 403                    | 관리자 API 차단·권한 부족·현재 공유 역할        |
| 계좌 없음              | 키에 선택했는지, 지금도 공유 중인지             |
| 409 또는 도구 충돌     | 최신 거래 조회 후 변경 내용 검토                |
| 429                    | 잠시 대기. 같은 생성 재시도는 동일 `request_id` |
| 503 또는 `busy`        | 동시 자료 처리 한도. 잠시 기다린 뒤 재시도      |

MCP는 HTTP 요청마다 인증하는 상태 없는 방식입니다. POST를 사용하며 GET·DELETE는405입니다. HTTP 본문은8MiB, 키당 분당120회입니다. 업무 호출에는 기존 API의 키당120회/분 제한도 함께 적용하므로 같은 키의 API와 MCP 업무 한도를 공유합니다.

API까지 전달된 요청은 입력·영수증 오류로 실패해도 API 호출 횟수와 사용 기록에 포함됩니다. MCP의 입력 정의 검사에서 먼저 거부된 호출은 업무 API까지 전달되지 않습니다. 저장 결과가 불확실하면 같은 `request_id`와 내용으로 재시도하세요.

키 폐기·보안 변경·백업 복원 시 접근이 차단됩니다. 서버 재시작은 키를 폐기하지 않습니다. 관리자 API 재허용 후 클라이언트가 연결을 종료한 상태라면 Codex를 다시 실행하세요.

[공식 Codex MCP 설정](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
