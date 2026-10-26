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

## 번역·문서 · Translation and documentation

- 화면: `web/src/i18n/ko.json`, `en.json`
- 서버 문구: `internal/app/i18n/en.json`
- 사용자 매뉴얼: `manual/ko/`, `manual/en/`

`{0}` 같은 치환자를 유지하고 사용자 입력 자료는 번역하지 않습니다. 새 언어는 카탈로그·선택지·서버 언어 검증·매뉴얼을 함께 추가합니다. 문서는 Markdown을 수정하며 앱용 HTML은 빌드 시 생성됩니다.

Preserve placeholders and user-entered data. A new language needs catalogs, selectors, server validation and manuals. Edit Markdown sources; bundled HTML is generated. Update `CHANGELOG.md` when user-visible behavior changes.

```bash
npm --prefix web run i18n:check
npm --prefix web run docs:check
```

## 릴리즈 · Releases

1. 앱·화면·OpenAPI 버전과 Compose 태그, 변경 기록을 갱신합니다. 버전 일치는 `node scripts/check-compose.mjs`로 확인합니다.
2. 일치하는 `vVERSION` 태그로 GitHub Release를 발행합니다. 알파·베타·RC는 사전 릴리즈로 표시합니다.
3. Actions가 검사 후 GHCR에 AMD64·ARM64 이미지를 게시합니다. 최초 게시 후 패키지는 Public으로 설정합니다.

Push/PR runs checks. A published Release or manual default-branch workflow publishes images. Version tags cannot be overwritten; only stable releases update `latest`. Publishing uses the workflow's `GITHUB_TOKEN` with `packages: write`.

기여 라이선스는 [AGPL-3.0-only](LICENSE)입니다. Contributions use AGPL-3.0-only.
