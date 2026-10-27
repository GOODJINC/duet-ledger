# 운영·업데이트·복구

[매뉴얼 홈](index.md) · [설치](installation.md)

## 평소 운영

Compose 파일이 있는 폴더에서 실행합니다. 다른 위치에서는 `docker compose -f /설치경로/compose.yaml`을 사용합니다.

```bash
docker compose ps
docker compose logs --tail 100 duet-ledger
docker compose restart duet-ledger
```

컨테이너는 재시작 정책에 따라 서버 부팅 후 다시 시작합니다. Docker 자체도 부팅 시 실행되어야 합니다. `/healthz`는 앱 상태 확인용이며 데이터 백업을 대신하지 않습니다.

## 업데이트

먼저 [변경 기록](https://github.com/GOODJINC/duet-ledger/blob/main/CHANGELOG.md)을 읽고 운영 백업과 `master.key`를 별도로 보관합니다. [Releases](https://github.com/GOODJINC/duet-ledger/releases)에서 대상 버전의 이미지 게시 완료를 확인합니다.

Compose와 같은 폴더의 `.env`에서 버전을 지정합니다. 예를 들어 0.1.1로 업데이트하려면 다음 값을 사용합니다.

```dotenv
DUET_LEDGER_IMAGE=ghcr.io/goodjinc/duet-ledger:0.1.1
```

Docker 관리 화면을 사용한다면 해당 화면의 환경변수 또는 `image` 태그를 바꿉니다. `.env`나 실행 환경에 `DUET_LEDGER_IMAGE`가 있으면 Compose 파일의 기본 이미지보다 우선합니다. 업데이트 시점을 직접 선택하려면 `latest` 대신 정확한 버전을 사용하세요.

```bash
docker compose pull duet-ledger
docker compose up -d
docker compose ps
docker compose logs --tail 100 duet-ledger
```

버전 태그를 고정한 경우 pull만으로 다른 버전으로 바뀌지는 않습니다. 실행 중인 컨테이너는 새 이미지 게시만으로 자동 교체되지 않습니다.

기존 데이터 볼륨·환경변수는 유지합니다. 구조가 자동 변경될 수 있으므로 **이전 이미지로만 바꾸는 것은 안전한 되돌리기가 아닙니다.** 되돌릴 때는 업데이트 전 자료 사본과 호환되는 앱 이미지를 함께 사용하세요.

## 다른 Docker 환경으로 이전

같은 Docker 서버에서는 기존 앱을 중지하고 `duet-ledger-data` 볼륨과 환경변수를 새 스택에 연결합니다. 다른 서버에서는 아래 백업·복원 절차를 사용합니다. **같은 자료를 두 앱에서 동시에 열지 마세요.**

## 백업과 복원

### 백업 만들기

관리자 메뉴의 **서버 운영 백업**에서 ZIP을 만들고 내려받습니다. 서버 실행 중 매일 자동 백업을 만듭니다. **자동 정리 시 수동 생성분을 포함해 서버 안의 최근 백업 7개만 유지합니다.** 같은 디스크의 사본만으로는 디스크 고장에 대비할 수 없으므로 다른 장치에도 복사하세요.

운영 ZIP에는 모든 사용자의 자료·영수증·공통 디자인이 포함되지만 **`master.key`는 포함되지 않습니다.** ZIP은 암호화되지 않습니다. GitHub·공개 공유 폴더에 올리지 마세요.

```bash
mkdir -p private-backup
chmod 700 private-backup
docker cp duet-ledger:/data/master.key ./private-backup/master.key
chmod 600 ./private-backup/master.key
```

내려받은 ZIP도 이 비공개 폴더에 둡니다. JSON·CSV 내보내기는 자료 이동용이며 운영 백업을 대신하지 않습니다.

### 별도 Docker 볼륨으로 시험 복원

**기존 운영 볼륨은 건드리지 않고 새 볼륨에서 복원합니다.** 아래 `BACKUP.zip`은 실제 파일명, `IMAGE`는 백업과 호환되는 앱 이미지로 바꾸세요. `docker inspect --format '{{.Config.Image}}' duet-ledger`로 확인할 수 있습니다.

```bash
docker volume create duet-ledger-restore-test
docker run --rm --user 0 \
  -v duet-ledger-restore-test:/restore \
  -v "$PWD/private-backup:/backup:ro,Z" \
  --entrypoint sh IMAGE -c \
  '/duet-ledger restore --archive /backup/BACKUP.zip --key-file /backup/master.key --data-dir /restore/restored && chown -R 10001:10001 /restore/restored'
```

`restored` 폴더는 새로 생성되며 이미 자료가 있으면 복원하지 않습니다. 원래 키와 백업이 맞아야 합니다. `:Z`는 SELinux 환경의 폴더 접근을 위한 옵션입니다. 이 폴더에는 복원용 사본만 두세요.

서버 내부에서만 열리는 별도 포트로 확인합니다.

```bash
docker run -d --name duet-ledger-restore-check \
  -p 127.0.0.1:18089:8080 \
  -e DUET_LEDGER_DATA_DIR=/data/restored \
  -v duet-ledger-restore-test:/data IMAGE
```

`http://localhost:18089`에서 다시 로그인해 거래 수·잔액·사진·공유 권한을 확인합니다. 복원하면 기존 로그인 세션·대기 초대·앱 비밀번호는 무효화됩니다. 계정과 기존 공유 관계 자체는 보존되므로 외부 공개 전 확인하세요.

실제 전환 시에는 시험 컨테이너를 중지한 뒤, 본래 `compose.yaml`에서 데이터 볼륨의 `name`을 `duet-ledger-restore-test`, `DUET_LEDGER_DATA_DIR`을 `/data/restored`로 변경하고 기존 서비스를 재생성합니다. **같은 볼륨을 두 서버에서 동시에 열지 마세요.** 이전 볼륨은 검증이 끝날 때까지 보존합니다.

### 로그인 비밀번호 복구

서버 관리 권한이 있고 로그인이 불가능할 때만 사용합니다. 계정 아이디를 확인하고 기존 앱을 중지합니다. 새 비밀번호는 8자 이상이어야 합니다.

```bash
docker compose stop duet-ledger
read -rsp '새 비밀번호: ' duet_new_password
printf '\n'
printf '%s' "$duet_new_password" | docker compose run --rm --no-deps -T \
  duet-ledger reset-password --username 실제아이디
unset duet_new_password
docker compose up -d
```

인증 앱·복구 코드도 잃었다면 `reset-password`에 `--disable-totp`를 추가할 수 있습니다. **이 작업은 해당 계정의 모든 세션과 앱 비밀번호를 폐기합니다.** 복구 후 2단계 인증과 연결 키를 다시 설정하세요.
