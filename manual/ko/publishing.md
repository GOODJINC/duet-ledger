# 이미지 게시·배포 준비 (관리자/개발자)

[매뉴얼 홈](index.md) · [설치](installation.md)

설치용 이미지는 `ghcr.io/goodjinc/duet-ledger`에 게시하도록 준비되어 있습니다. **설정 파일을 커밋한 것만으로 이미지를 내려받을 수 있는 것은 아닙니다. 첫 게시와 Public 설정을 완료해야 합니다.**

## 처음 한 번 할 일

1. 로컬 변경 사항을 GitHub의 `main`에 푸시합니다. 저장소 **Actions**에서 `Docker image`의 테스트가 성공하는지 확인합니다. 일반 푸시는 검사만 하고 이미지는 게시하지 않습니다.
2. 같은 Actions의 **Docker image → Run workflow → main → Run workflow**를 선택합니다. 테스트 후 앱의 현재 버전(현재 `0.1.0-alpha.12`)을 AMD64·ARM64 이미지로 빌드해 GHCR에 게시합니다. 게시 완료까지 기다립니다.
3. GitHub 프로필 → **Packages → duet-ledger → Package settings → Change visibility → Public**으로 변경합니다. 저장소 공개와 패키지 공개는 별개입니다. 공개하면 누구나 로그인 없이 내려받을 수 있습니다.
4. 아래 명령을 **GHCR에 로그인하지 않은 다른 환경**에서 실행해 공개 다운로드를 확인합니다. 동작 중인 Docker의 로그인 설정을 지울 필요는 없습니다.

```bash
docker pull ghcr.io/goodjinc/duet-ledger:0.1.0-alpha.12
```

새 GitHub 개인 토큰은 필요하지 않습니다. 워크플로가 제공하는 `GITHUB_TOKEN`과 `packages: write` 권한을 사용합니다. Actions가 비활성화되어 있다면 저장소 Settings → Actions에서 이 저장소의 워크플로 실행을 허용합니다.

## 이후 버전 게시

앱 버전·화면 표시·OpenAPI 버전·Compose 기본 태그와 변경 기록을 갱신하고 검사한 뒤 새 버전을 커밋합니다. 저장소 Releases에서 앱과 같은 `v버전` 태그를 선택해 공개 릴리즈를 발행하면 자동 게시합니다. 예: 앱 `0.1.0-beta.1` → 태그 `v0.1.0-beta.1`, **Set as a pre-release 선택**. 정식 `1.0.0`은 사전 릴리즈 체크를 끕니다.

| 앱 버전 | 게시 태그 |
| --- | --- |
| `0.1.0-alpha.12` | `0.1.0-alpha.12`, `alpha` |
| `0.1.0-beta.1` | `0.1.0-beta.1`, `beta` |
| `0.1.0-rc.1` | `0.1.0-rc.1`, `rc` |
| `1.0.0` | `1.0.0`, `latest` |

알파·베타·RC는 `latest`를 갱신하지 않습니다. 버전 태그 중복 게시도 거부합니다. 실패가 게시 직후 발생해 이미지가 이미 있다면 패키지 상태를 확인하고, 이미지 변경이 필요할 때는 새 앱 버전을 사용하세요. 운영에는 채널보다 정확한 버전 태그를 권장합니다.

이미지는 `linux/amd64`, `linux/arm64`를 빌드합니다. 32비트 ARM·Windows 컨테이너 이미지는 제공하지 않습니다. 로컬 환경에서 AMD64 실행·ARM64 교차 컴파일을 확인하며, 실제 GHCR 게시와 ARM64 최종 이미지 빌드는 Actions 성공 여부로 확인합니다.

## 파일 구분

- `compose.yaml`: 공개 이미지 설치. 기본127.0.0.1 바인딩.
- `compose.arcane.yaml`: Arcane/LAN 설치. 기본0.0.0.0 바인딩으로 서버 네트워크에서 접속 가능.
- `compose.build.yaml`: 소스 빌드용 덮어쓰기. 개발자는 `docker compose -f compose.yaml -f compose.build.yaml up -d --build`를 사용합니다.

Arcane용 파일은 기본 Compose와 설정을 공유합니다. 기본 파일을 수정했다면 `node scripts/sync-compose.mjs`로 Arcane 파일을 갱신하고 `--check`로 확인합니다.

## 게시 오류

- `permission_denied`/403: 저장소·패키지 **Manage Actions access** 연결과 작업의 `packages: write` 권한을 확인합니다. 예전에 다른 방식으로 만든 패키지는 해당 저장소에 접근 권한을 별도로 부여해야 할 수 있습니다.
- Public 설정 후에도 pull 실패: Actions가 실제 해당 버전 태그 게시까지 성공했는지 확인합니다. 아직 없는 `latest`나 `beta`를 사용하지 마세요.
- 버전 불일치: 릴리즈 태그와 코드의 버전을 맞추고 알파·베타·RC의 사전 릴리즈 체크를 확인합니다.
- 수동 실행에서 publish가 생략됨: 기본 브랜치 `main`을 선택했는지 확인합니다.

[GitHub GHCR 안내](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) · [Docker 다중 플랫폼 빌드](https://docs.docker.com/build/ci/github-actions/multi-platform/)
