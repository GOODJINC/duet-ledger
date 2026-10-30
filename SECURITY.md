# 보안 제보 · Security reports

최신 공개 버전을 기준으로 보안 문제를 확인합니다. 업데이트 전에는 변경 기록을 읽고 자료를 백업해 주세요.

Security reports are assessed against the latest published version. Review the changelog and back up your data before updating.

저장소의 Security → Report a vulnerability가 제공되면 비공개로 제보해 주세요. 사용할 수 없다면 공개 이슈에 공격 방법을 적지 말고 비공개 연락 경로를 요청해 주세요.

Use Security → Report a vulnerability when available. Otherwise, request a private contact channel in an issue without publishing exploit details.

**비밀번호·앱 비밀번호·쿠키·master.key·백업·실제 금융 자료를 공개하지 마세요.** 스크린샷과 로그에서도 제거합니다.

**Never publish passwords, app passwords, cookies, master.key, backups or real financial data.** Redact screenshots and logs too.

## 기기의 오프라인 사본 · Offline device copies

오프라인 저장은 기본 켜짐입니다. 공용 기기에서는 **설정 → 오프라인 내역**에서 끄세요. 기기의 조회 사본과 미전송 기록은 서버 DB와 별개이며, 브라우저 저장소는 별도 암호화 금고가 아닙니다. 비밀번호·로그인 쿠키·CSRF 비밀은 기기 DB에 저장하지 않습니다. 서버에 전송할 때는 로그인·현재 접근 권한·거래 버전·자료 기준을 다시 확인합니다.

Offline storage is enabled by default. Turn it off on shared devices under **Settings → Offline records**. Cached views and pending work are separate from the server database; browser storage is not a separately encrypted vault. Passwords, session cookies and CSRF secrets are not stored in the device database. Server writes recheck authentication, current access, transaction versions and dataset generation.

연결이 끊긴 기기의 사본을 즉시 원격 삭제할 수는 없습니다. 사이트 데이터 삭제·기기 분실·브라우저 저장소 정리는 미전송 기록을 잃게 할 수 있습니다. **대기 기록 내보내기 파일과 첨부 사진에도 실제 금융 자료가 있으므로 비공개로 보관하세요.** 자세한 사용 범위는 [오프라인 안내](manual/ko/offline.md)를 확인하세요.

Copies on disconnected devices cannot be remotely erased immediately. Clearing site data, losing the device or browser storage eviction can lose unsent work. **Keep pending-record exports and photos private: they contain financial data.** See the [offline guide](manual/en/offline.md).
