# 기여 · Contributing

오류와 제안은 [GitHub Issues](https://github.com/GOODJINC/duet-ledger/issues)에 재현 순서·앱 버전·예상/실제 결과를 적어 주세요. 실제 금융 자료와 인증 정보는 제거합니다. 기능 변경은 관련 이슈와 함께 작게 나누어 제안하세요.

Report bugs and ideas in GitHub Issues with reproduction steps, version and expected/actual behavior. Remove financial data and credentials. Keep pull requests focused and link related issues.

## 개발 · Development

Go(`go.mod` 기준), Node.js와 npm이 필요합니다. 앱은 Go 서버·SQLite·React/TypeScript로 구성됩니다.

```bash
npm --prefix web ci
npm --prefix web run build
go test ./...
go vet ./...
npm --prefix web test
make build
node scripts/smoke.mjs
```

`make test`는 빌드·Go/웹 테스트·임시 자료 기반 실행 검증을 수행합니다. 실제 운영 볼륨으로 테스트하지 마세요. Docker 동시성 검사는 `docker build --target checks .`로 실행합니다.

`make test` builds and runs Go/web tests and an executable smoke test with disposable data. Never test against your production volume. Run Docker race checks with `docker build --target checks .`.

## 번역 · Translations

- 화면 원문/번역: `web/src/i18n/ko.json`, `en.json`.
- 서버 시스템 문구: `internal/app/i18n/en.json`. 한국어 원문은 코드에 있으며 영어 오류는 요청/사용자 언어를 따릅니다.
- 공개 매뉴얼: `manual/ko/`, `manual/en/`. 앱 안내 HTML은 빌드 시 생성하므로 직접 수정하지 않습니다.
- `{0}`, `{1}` 같은 치환자를 모두 유지합니다. 계좌 이름·메모 등 사용자 데이터를 번역하지 않습니다.

UI catalogs use Korean source phrases as message keys. Preserve every `{0}`, `{1}` placeholder. Server messages have a separate English catalog. Manuals are Markdown; bundled HTML is generated. User-entered data must never be translated.

새 언어 기여는 언어 파일만 추가하는 것으로 완료되지 않습니다. `web/src/i18n/index.ts`의 지원 언어, 로그인/설정 선택지, 서버 locale 검증과 매뉴얼도 함께 추가하고 검증해야 합니다. 현재 완성된 지원 언어는 한국어와 영어입니다.

Adding a language also requires registering it in the UI locale module and selectors, updating server locale validation, adding manuals and tests. Currently supported languages are Korean and English.

## 문서와 변경 기록 · Documentation

공개 문서는 `manual/`에 둡니다. `docs/`는 Git에서 제외한 로컬 개발 기록입니다. `npm --prefix web run docs:check`로 문서 링크와 제목 연결을 확인합니다. 기능 변경 시 사용자 문서와 `CHANGELOG.md`를 함께 갱신하세요.

Public manuals live in `manual/`; local `docs/` is excluded from Git. Validate manual links using `npm --prefix web run docs:check`. Update manuals and `CHANGELOG.md` when behavior changes.

기여는 저장소의 AGPL-3.0-only 라이선스로 제공됩니다. Contributions are licensed under the repository's AGPL-3.0-only license.

## 소스 빌드와 이미지 게시 · Source builds and publishing

소스에서 Docker를 빌드할 때는 설치용 Compose에 개발용 덮어쓰기를 함께 지정합니다.

```bash
git clone https://github.com/GOODJINC/duet-ledger.git
cd duet-ledger
docker compose -f compose.yaml -f compose.build.yaml up -d --build
node --test scripts/image-metadata.test.mjs
node scripts/sync-compose.mjs --check
```

`compose.yaml`·`compose.arcane.yaml`은 공개 이미지 설치용입니다. `compose.build.yaml`은 소스 빌드만 선택합니다. 게시 준비는 [한국어](manual/ko/publishing.md) / [English](manual/en/publishing.md) 안내를 따릅니다. 첫 이미지 게시 전에는 GHCR pull이 실패할 수 있습니다.

The default Compose files install published images. Use the build override for local source builds. GitHub pushes/PRs run checks; published Releases or a manual default-branch workflow run publish images. Prereleases never update latest; exact published version tags cannot be overwritten.
