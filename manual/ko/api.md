# REST API 매뉴얼

[매뉴얼 홈](index.md) · [MCP](mcp.md)

## 목차

- [연결과 인증](#연결과-인증)
- [Postman 사용](#postman-사용)
- [금액과 날짜 규칙](#금액과-날짜-규칙)
- [권한과 경로](#권한과-경로)
- [조회와 통계](#조회와-통계)
- [생성·수정·삭제·복구](#생성수정삭제복구)
- [영수증](#영수증)
- [오류·제한·운영](#오류제한운영)

## 연결과 인증

기본 주소는 `http://서버주소:18088/api/v1`입니다. HTTPS·포트를 바꿨다면 실제 주소를 사용합니다. 웹 화면용 `/api/...`는 별도의 쿠키 인증 API이며 외부 앱 비밀번호용이 아닙니다.

1. 관리자가 관리 메뉴 → **외부 API · MCP → API 사용 허용**을 켭니다.
2. 사용자는 **계정 설정 → API 앱 비밀번호 → 앱 비밀번호 만들기**에서 연결 이름·계좌·권한을 선택합니다.
3. 유효기간은 `30일`, `90일`, `1년(365일)`, `만료 없음`입니다. 현재 비밀번호와 필요한 2단계 인증을 확인하고 발급합니다.
4. 앱 비밀번호는 한 번만 표시합니다. 연결마다 별도 키를 사용하고 언제든 폐기하세요.

```http
Authorization: Bearer APP_PASSWORD
Content-Type: application/json
```

일반 로그인 비밀번호나 Basic 인증은 사용하지 않습니다. 키를 URL·프롬프트·로그·Git에 넣지 마세요. 공개 인터넷에서는 HTTPS를 사용합니다.

## Postman 사용

컬렉션 또는 환경에 `base_url`을 `http://서버주소:18088`, `account_id`를 사용할 계좌 ID로 설정하면 예제를 그대로 재사용할 수 있습니다. Authorization의 **Bearer Token**에 앱 비밀번호를 넣습니다. 클라우드에 동기화하거나 공유하는 변수·컬렉션에는 실제 키를 저장하지 마세요.

### 계좌 확인

**GET** `{{base_url}}/api/v1/accounts` → Send. 응답에서 원하는 계좌의 `id`, `currency`, `scale`을 확인하고 `account_id`에 넣습니다. 조회와 추가 권한이 모두 있어야 다음 예제를 한 키로 진행할 수 있습니다.

### 지출 입력

**POST** `{{base_url}}/api/v1/transactions`

Headers 탭에서 아래 행을 추가하고 왼쪽 체크박스를 켭니다. **Body나 Params에 넣는 값이 아닙니다.**

| Key             | Value               |
| --------------- | ------------------- |
| Content-Type    | application/json    |
| Idempotency-Key | example-expense-001 |

Body → raw → JSON:

```json
{
  "account_id": "{{account_id}}",
  "kind": "expense",
  "date": "2026-01-15",
  "time": "12:30",
  "amount": "12000",
  "title": "점심 식사",
  "category": "food",
  "note": ""
}
```

예시의 날짜·계좌 ID·분류를 실제 사용할 값으로 바꿉니다. 원화 계좌 기준 예시입니다. **실제 기록에 바로 저장됩니다.** 처음 생성은 `201`과 `{"id":"거래ID"}`, 같은 입력·같은 키의 재시도는 `200`과 같은 ID를 반환합니다. 새 거래는 새 `Idempotency-Key`를 사용합니다.

### 월 통계

**GET** `{{base_url}}/api/v1/statistics`

Params:

| Key              | Value          |
| ---------------- | -------------- |
| from             | 2026-01-01     |
| to               | 2026-01-31     |
| account          | {{account_id}} |
| display_currency | KRW            |

`count`, `totals`, `categories`, `daily`로 거래 수·전체 합계·분류별·날짜별 합계를 확인합니다. 날짜를 같게 지정하면 하루 통계입니다. `account`를 빼면 키로 접근 가능한 계좌 전체를 조회합니다.

## 금액과 날짜 규칙

| 필드       | 규칙                                                                           |
| ---------- | ------------------------------------------------------------------------------ |
| 금액       | 통화 최소 단위의 **정수 문자열**. KRW 1,000원=`"1000"`, USD 12.34달러=`"1234"` |
| `scale`    | 소수 자릿수. KRW·JPY·VND=0, USD·EUR·GBP·CNY·TWD=2, KWD=3                       |
| `date`     | `YYYY-MM-DD`, 1900~2100년                                                      |
| `time`     | `HH:mm` 24시간. 생략 가능; 새 입력에는 지정을 권장                             |
| `timezone` | IANA 시간대. 생략하면 사용자 설정                                              |
| ID         | 계좌/거래/영수증 조회에서 받은 식별자. 거래 ID는 계좌별 posting ID             |

새 수입·지출·이체의 `amount`는 양수로 보냅니다. 조회 응답의 계좌 증감 `legs[].amount`는 지출·출금이 음수입니다. 이 값을 그대로 생성 입력에 복사하지 마세요. 금액은 숫자형으로 변환하면 정밀도를 잃을 수 있으므로 문자열로 다룹니다.

외화 결제는 `original_currency`, `original_amount`, `exchange_rate`를 함께 지정합니다. `original_amount`는 원래 통화의 최소 단위이며, `exchange_rate`는 원래 통화 1단위당 계좌 통화 금액입니다. `amount`는 환산·반올림한 **계좌 반영 금액**이어야 합니다. 예: KRW 계좌에서 USD 20 × 1,400원 → `amount="28000"`, `original_currency="USD"`, `original_amount="2000"`, `exchange_rate="1400"`.

## 권한과 경로

모든 경로 앞에 `/api/v1`을 붙입니다.

| 메서드·경로                        | 키 권한           | 용도                       |
| ---------------------------------- | ----------------- | -------------------------- |
| GET `/me`                          | 유효한 키         | 사용자·시간대·통화·키 권한 |
| GET `/accounts`                    | read              | 허용 계좌·통화·잔액        |
| GET `/categories`                  | read              | 계좌별 분류                |
| GET `/transactions`                | read              | 거래 목록과 전체 범위 집계 |
| GET `/transactions/{id}`           | read              | 거래 한 건과 최신 버전     |
| GET `/statistics`                  | read              | 집계만 조회                |
| POST `/transactions`               | create            | 거래 생성                  |
| PUT `/transactions/{id}`           | update            | 전체 거래 수정             |
| DELETE `/transactions/{id}`        | delete            | 휴지통 이동                |
| POST `/transactions/{id}/restore`  | delete            | 휴지통 복구                |
| POST `/transactions/{id}/receipts` | receipts          | 사진 첨부                  |
| GET `/receipts/{id}`               | read              | 사진 다운로드              |
| DELETE `/receipts/{id}`            | delete + receipts | 사진 첨부 해제             |

키 권한과 현재 계좌 공유 역할을 **모두** 만족해야 합니다. 조회자로 공유받은 계좌는 쓰기 키라도 수정할 수 없습니다. 새 계좌는 기존 키에 자동 추가되지 않습니다. 계좌 범위 밖 이체 상대 정보·잔액·집계는 노출하지 않으며, 이체 수정·삭제·복구에는 양쪽 계좌의 현재 편집 권한과 키 접근이 필요합니다.

키로 신규 계좌·키를 만들거나 사용자·공유·서버 설정을 바꾸는 기능, 영구 삭제는 제공하지 않습니다.

## 조회와 통계

`GET /me`는 사용자 `id`, `name`, `timezone`, `default_currency`, 키 이름·ID·만료, `permissions`, `account_ids`를 반환합니다. `GET /accounts`는 허용된 계좌 배열을 반환합니다.

분류: `GET /categories?account=계좌ID&kind=expense` 또는 `kind=income`. 반환된 `code`를 거래의 `category`로 사용합니다. 직접 입력한 이름을 분류 코드로 대신 보내지 마세요.

가계부에 등록된 공통 분류와 조회 계좌의 거래에서 수집한 분류를 반환합니다. 다른 계좌의 거래에서만 사용한 분류는 포함하지 않습니다.

목록·통계 공통 필터:

| Params              | 의미                                                 |
| ------------------- | ---------------------------------------------------- |
| `from`, `to`        | 양 끝 날짜 포함. 생략하면 사용자 시간대의 이번 달    |
| `account`, `ledger` | 계좌 또는 가계부 ID로 제한                           |
| `scope`             | `all`, `private`, `shared`                           |
| `type`              | `income`, `expense`, `transfer` 등 저장된 거래 종류  |
| `search`            | 내용·메모·분류명·작성자 이름/아이디 검색, 최대 300자 |
| `currency`          | 계좌 통화로 필터, 예: `USD`                          |
| `display_currency`  | 설정 환율을 사용한 합계 통화, 예: `KRW`              |
| `trash`             | `true`이면 휴지통 거래 조회                          |
| `page`, `page_size` | 목록 페이지. 기본 1페이지·50건, 페이지 크기 1~200    |

`GET /transactions`는 `items`, `count`, `page`, `page_size`, `totals`, `categories`, `daily`를 반환합니다. 거래의 `version`을 수정에 사용하고 `legs`에서 각 계좌 반영액·분류·영수증 ID를 찾습니다. `can_edit`는 실제 편집 가능 여부입니다.

`GET /statistics`는 `count`, `totals`, `categories`, `daily`, `missing_currencies`를 반환합니다. 집계는 페이지와 관계없이 허용된 전체 조회 범위 기준입니다. 통화를 지정하지 않으면 통화별로 구분하며 서로 다른 통화를 그대로 더하지 않습니다. 환산할 환율이 없으면 해당 통화를 합계에서 제외하고 `missing_currencies`로 알립니다. 환율은 자동 실시간 환율이 아니라 사용자에게 저장된 값입니다.

```json
{
  "count": 1,
  "totals": [
    { "currency": "KRW", "scale": 0, "income": "0", "expense": "12000" }
  ],
  "categories": [
    {
      "name": "식비",
      "currency": "KRW",
      "scale": 0,
      "category": "food",
      "amount": "12000"
    }
  ],
  "daily": [
    {
      "currency": "KRW",
      "scale": 0,
      "date": "2026-01-15",
      "income": "0",
      "expense": "12000"
    }
  ],
  "missing_currencies": []
}
```

## 생성·수정·삭제·복구

생성 JSON 필드:

| 필드                       | 용도                                        |
| -------------------------- | ------------------------------------------- |
| `kind`                     | 새 거래는 `expense`, `income`, `transfer`   |
| `account_id`               | 기록할 계좌 또는 이체 출금 계좌             |
| `date`, `time`, `timezone` | 거래 날짜·시간·시간대                       |
| `amount`, `title`          | 양수 최소 단위 금액·거래 내용               |
| `category`                 | 계좌에 등록된 분류 코드. 이체는 `transfer`  |
| `note`, `target_note`      | 출금/일반 메모, 이체 대상 계좌 메모         |
| `to_id`                    | 이체일 때 받는 계좌. 현재 같은 통화만 지원  |
| 외화 3개 필드              | 앞 절의 원금액·환율 정보                    |
| `ledger_id`                | 선택 사항. 해당 가계부의 계좌인지 추가 검사 |

`Idempotency-Key`는 128바이트 이내로 거래마다 새 값을 만듭니다. 통신이 끊겨 결과가 불명확하면 **같은 내용과 같은 키**로 재시도합니다. 같은 키에 다른 내용을 보내면 `409`입니다. 중복 방지는 앱 비밀번호별입니다. 웹에서 영구 삭제한 기록의 요청 키는 재사용할 수 없으며 `409`를 반환합니다. 새 기록에는 새 키를 만드세요.

수정은 **PATCH가 아닌 PUT**입니다. 먼저 `GET /transactions/{id}`로 최신 내용을 조회하고, 위 입력 JSON 전체와 `version`을 보냅니다. 외화·메모·분류 등 유지할 값도 함께 넣습니다. 성공하면 `200`, 새 posting ID와 계좌별 `posting_ids`를 반환합니다. 다시 조회해 새 버전을 확인하세요.

휴지통 이동·복구의 Body → raw → JSON은 다음과 같습니다. 아래 숫자는 예시이며 현재 버전을 사용합니다.

```json
{ "version": 1 }
```

삭제 후 복구하려면 `GET /transactions/{id}` 또는 휴지통 조회로 변경된 버전을 다시 확인합니다. 다른 사용자가 먼저 변경하면 `409`가 발생합니다. 최신 값을 검토한 뒤 다시 요청하며 버전을 임의로 올리지 마세요.

## 영수증

사진 첨부는 **POST** `/transactions/{거래postingID}/receipts`, Body → **form-data**로 보냅니다. Key는 `file`, 오른쪽 유형을 **File**로 바꾸고 사진을 고릅니다. Postman이 multipart 경계를 생성하므로 이 요청에서는 직접 지정한 `Content-Type: application/json` 헤더를 끕니다.

JPG·PNG, 5MB 이하·1,600만 화소 이하를 지원합니다. 저장 시 JPEG 정규화·메타데이터 제거가 적용됩니다. 성공 `201` 응답의 `id`, `size`, `media_type`을 보관합니다.

`GET /receipts/{id}`는 JSON이 아닌 이미지 응답입니다. Postman의 파일 저장 기능으로 보관할 수 있습니다. `DELETE /receipts/{id}`는 첨부를 해제합니다. **별도 복구 API가 없으며 delete와 receipts 권한이 모두 필요합니다.**

## 오류·제한·운영

```json
{ "error": "invalid", "message": "입력을 확인해 주세요." }
```

`error`는 기계 처리용 코드, `message`는 사용자 설명입니다. 설명 문구를 프로그램 분기 조건으로 쓰지 마세요. `Accept-Language: en` 또는 `ko`로 오류 언어를 요청할 수 있으며 생략하면 인증된 사용자의 언어를 따릅니다.

| 상태 | 확인할 내용                                       |
| ---- | ------------------------------------------------- |
| 400  | JSON·필드·분류·금액·Idempotency-Key               |
| 401  | Bearer 키 오입력·만료·폐기                        |
| 403  | 관리자 API 차단·키 기능 권한·현재 공유 역할       |
| 404  | 현재 허용 범위에서 대상을 찾을 수 없음            |
| 409  | 최신 version 충돌 또는 같은 생성 키에 다른 입력   |
| 429  | 호출 한도. `Retry-After`를 확인하고 재시도        |
| 500  | 서버 상태 확인. 생성 재시도는 같은 입력·키를 사용 |
| 503  | 임시 파일 처리 한도. 잠시 기다린 뒤 재시도        |

유효한 키의 업무 API 호출은 키당 분당 120회입니다. 본문을 받기 전에 횟수를 집계하므로 잘못된 영수증·입력 등 실패한 요청도 포함됩니다. 제한을 넘으면 본문을 처리하지 않고 `429`와 `Retry-After`를 반환합니다.

일반 요청 본문은 22MiB 이하이며 사진 자체 제한은 별도입니다. 일반 요청·응답 임시 파일은 서버에서 합산 32MiB까지 사용합니다. 동시 처리가 한도를 넘으면 `503`과 `error: busy`를 반환할 수 있으므로 대기 후 재시도하세요. 생성 결과가 불확실하면 같은 입력·같은 `Idempotency-Key`를 사용합니다.

한 조회는 계좌별 증감 4만 개까지이며 넘으면 기간이나 계좌를 좁혀야 합니다. 사용 기록은 최근 100건을 표시하고 서버에는 사용자별 최대 1,000건을 보관합니다. 인증된 실패 요청도 기록하며 키·본문·검색어는 저장하지 않습니다.

관리자 차단은 기존 키를 일시 중지하고 재허용 시 유효한 키를 다시 쓸 수 있습니다. 키 폐기·비밀번호/보안 설정 변경·백업 복원은 키를 무효화합니다. 일반 로그아웃·모든 기기 로그아웃·앱 재시작은 키를 폐기하지 않습니다. 앱 비밀번호 화면에서 키를 개별 폐기할 수 있습니다.

명세 파일은 서버의 `/openapi.json`에 있으며 Postman으로 가져올 수 있습니다. 이 파일에는 웹 내부 경로도 포함되므로 외부 연동은 위 `/api/v1` 경로만 사용하세요. 다른 웹사이트에서의 공개 CORS·OAuth·은행 자동 연동은 현재 지원하지 않습니다.
