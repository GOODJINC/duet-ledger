FROM --platform=$BUILDPLATFORM node:22.23.1-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY web/ ./
COPY manual/ /src/manual/
COPY internal/app/i18n/ /src/internal/app/i18n/
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.27.3-alpine AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY --from=web /src/internal/webassets/dist ./internal/webassets/dist
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -trimpath -ldflags="-s -w" -o /duet-ledger ./cmd/duet-ledger

FROM server AS checks
RUN apk add --no-cache gcc musl-dev && CGO_ENABLED=1 go test -race ./internal/app

FROM alpine:3.23
ARG IMAGE_VERSION=development
ARG IMAGE_REVISION=unknown
LABEL org.opencontainers.image.title="Duet Ledger" \
      org.opencontainers.image.description="Self-hosted personal and shared finance tracker" \
      org.opencontainers.image.source="https://github.com/daytivehq/duet-ledger" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version=$IMAGE_VERSION \
      org.opencontainers.image.revision=$IMAGE_REVISION
RUN apk add --no-cache ca-certificates tzdata && addgroup -g 10001 duet-ledger && adduser -D -u 10001 -G duet-ledger duet-ledger && mkdir /data && chown 10001:10001 /data
COPY --from=server /duet-ledger /duet-ledger
COPY LICENSE /licenses/DUET-LEDGER-AGPL-3.0.txt
COPY web/public/third-party-licenses.txt /licenses/THIRD-PARTY.txt
USER 10001:10001
ENV DUET_LEDGER_DATA_DIR=/data DUET_LEDGER_LISTEN=0.0.0.0:8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/duet-ledger"]
CMD ["serve"]
