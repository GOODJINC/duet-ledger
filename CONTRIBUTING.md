# 기여 · Contributing

[GitHub Issues](https://github.com/GOODJINC/duet-ledger/issues)에 재현 순서·앱 버전·예상 결과와 실제 결과를 적어 주세요. 기능 변경은 관련 이슈를 연결한 작은 PR로 제안합니다. 비밀번호와 금융 자료는 제거해 주세요.

Report issues with reproduction steps, version and expected/actual behavior. Keep pull requests focused and link related issues. Remove credentials and financial data.

## 개발 · Development

Go(`go.mod` 기준), Node.js22, npm과 Docker Compose를 사용합니다. 소스에서 실행할 때는 독립된 개발용 Compose를 사용합니다.

```bash
git clone https://github.com/GOODJINC/duet-ledger.git
cd duet-ledger
cp .env.dev.example .env.dev
docker compose --env-file .env.dev -f compose.dev.yaml up -d --build
```

개발 컨테이너는 `duet-ledger-dev`, 이미지는 `duet-ledger:dev`, 데이터 볼륨은 `duet-ledger-dev-data`입니다. 기본 접속 주소는 `http://localhost:18088`이며 `.env.dev`에서 변경합니다. 실사용 컨테이너·포트·데이터와 분리됩니다. 처음에는 빈 데이터로 시작합니다.

코드를 수정한 뒤에는 같은 `up -d --build` 명령을 실행합니다. 개발 자료는 유지되고 GitHub 게시 없이 수정 사항이 반영됩니다. 중지할 때는 다음을 사용합니다.

```bash
docker compose --env-file .env.dev -f compose.dev.yaml down
```

`down -v`는 개발 자료까지 삭제하므로 주의하세요. 실사용 볼륨을 개발 컨테이너에 연결하지 않습니다.

호스트에서 검사하려면 다음을 실행합니다. 테스트에는 별도 임시 자료를 사용합니다.

```bash
npm --prefix web ci
npm --prefix web run build
npm --prefix web test
go test ./...
go vet ./...
go build -o bin/duet-ledger ./cmd/duet-ledger
node scripts/smoke.mjs
node --test scripts/image-metadata.test.mjs
node scripts/check-compose.mjs
```

Use standalone `compose.dev.yaml` with `.env.dev` for development. It uses a separate container, local image, port and data volume; rebuild after source changes. Production data is never mounted. Tests use disposable datasets; never attach production data. Run Docker race checks with `docker build --target checks .`.

## 화면 코드 구조 · Frontend structure

- `main.tsx`: 앱 시작·로그인 상태 복구. `auth.tsx`: 로그인·회원가입 화면.
- `app.tsx`: 화면 전환·조회 조건·자료 로딩·팝업 연결.
- `settings.tsx`: 계정·브라우저·관리 설정. `navigation.ts`: 경로·메뉴 정의.
- `ledger-views.tsx`: 거래 목록·행·달력. `dashboard-panels.tsx`: 요약·차트·계좌 패널.
- `dates.ts`, `accounts.ts`: 공통 날짜·시간 처리와 화면의 입력 가능 계좌 판단.

컴포넌트는 해당 모듈에서 직접 가져옵니다. 앱 시작 파일을 재사용 모듈로 가져오지 않습니다. 권한 검증의 최종 책임은 서버에 있습니다.

Import components from their owning modules, rather than the startup entry point. Shared helpers keep the existing rules; the server remains responsible for authorization.

## 번역·문서 · Translation and documentation

- 화면: `web/src/i18n/ko.json`, `en.json`
- 서버 문구: `internal/app/i18n/en.json`
- 사용자 매뉴얼: `manual/ko/`, `manual/en/`

화면 문구를 바꾸면 두 UI 카탈로그를 함께 갱신하고 사용하지 않는 키를 제거합니다. 검사는 누락·남은 키·자리표시자를 확인합니다.

`{0}` 같은 치환자를 유지하고 사용자 입력 자료는 번역하지 않습니다. 새 언어는 카탈로그·선택지·서버 언어 검증·매뉴얼을 함께 추가합니다. 문서는 Markdown을 수정하며 앱용 HTML은 빌드 시 생성됩니다. 새 매뉴얼 페이지는 한·영 원본과 묶음 빌더 목록에 함께 추가합니다.

Update both UI catalogs and remove unused keys. Preserve placeholders and user-entered data. A new language needs catalogs, selectors, server validation and manuals. Edit Markdown sources; bundled HTML is generated. Add new manual pages in both languages and in the bundled-manual builder. Update `CHANGELOG.md` when user-visible behavior changes.

```bash
npm --prefix web run i18n:check
npm --prefix web run docs:check
```

## 릴리즈 · Releases

1. 앱·화면·npm 패키지·OpenAPI·라이선스 고지·Compose·환경 예제의 버전을 맞춥니다. `node scripts/check-compose.mjs`로 확인하고 한·영 매뉴얼과 변경 기록(`CHANGELOG.md`, `CHANGELOG.en.md`)을 갱신합니다. 릴리즈할 때는 변경 기록의 ‘배포 준비 중’을 실제 릴리즈 날짜로 바꿉니다.
2. 전체 검사를 통과한 변경 사항을 커밋·푸시합니다. **main 푸시는 검사만 실행하며 이미지를 게시하지 않습니다.**
3. 일치하는 `vVERSION` 태그로 GitHub Release를 발행합니다. 예: `v0.1.1`. 정식 버전은 사전 릴리즈로 표시하지 않습니다. 알파·베타·RC만 사전 릴리즈로 표시합니다.
4. Actions의 GHCR AMD64·ARM64 이미지 게시 완료를 확인합니다. 최초 게시 후 패키지는 Public으로 설정합니다. 사용자는 이미지가 게시된 뒤 업데이트합니다.

Push/PR runs checks. A published Release or manual default-branch workflow publishes images. Version tags cannot be overwritten; only stable releases update `latest`. Publishing uses the workflow's `GITHUB_TOKEN` with `packages: write`.

기여 라이선스는 [AGPL-3.0-only](LICENSE)입니다. Contributions use AGPL-3.0-only.
