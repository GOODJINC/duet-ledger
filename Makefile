GO ?= go
.PHONY: build test web run
web:
	cd web && npm ci --no-fund --no-audit && npm run build
build: web
	CGO_ENABLED=0 $(GO) build -trimpath -o bin/duet-ledger ./cmd/duet-ledger
test: web
	$(GO) test ./...
	cd web && npm run test
	CGO_ENABLED=0 $(GO) build -o bin/duet-ledger ./cmd/duet-ledger
	node scripts/smoke.mjs
run: build
	./bin/duet-ledger serve
