import { type Account } from "./api";
import { msg } from "./i18n";
import { Privacy } from "./ui";

export function AccessReview({ accounts }: { accounts: Account[] }) {
  const roleName = (role: string) =>
    role === "owner"
      ? msg("책임자")
      : role === "editor"
        ? msg("편집자")
        : msg("조회자");
  return (
    <details className="access-review">
      <summary>{msg("내 계좌 접근 권한 확인")}</summary>
      <p className="entry-hint">
        {msg(
          "조회자는 보기만, 편집자는 거래 입력·수정·삭제가 가능해요. 여러 공유 경로가 있으면 가장 높은 권한이 적용돼요.",
        )}
      </p>
      <p className="entry-hint">
        {msg(
          "공유 경로 하나를 해제해도 다른 경로가 남아 있으면 계속 접근할 수 있어요.",
        )}
      </p>
      {accounts.map((account) => (
        <div className="access-review-row" key={account.id}>
          <div>
            <strong>{account.name}</strong>
            <span>
              {account.owner_name} · {roleName(account.role)}
              {account.archived ? msg(" · 보관됨") : ""}
            </span>
            <ul>
              {account.access_paths?.map((path) => (
                <li key={path.type}>
                  {path.type === "owner"
                    ? msg("계좌 소유")
                    : path.type === "ledger"
                      ? msg("가계부 전체 공유")
                      : msg("계좌 직접 공유")}{" "}
                  · {roleName(path.role)}
                </li>
              ))}
            </ul>
          </div>
          <Privacy shared={account.shared} />
        </div>
      ))}
      {!accounts.length && (
        <p className="entry-hint">
          {msg("아직 접근할 수 있는 계좌가 없어요.")}
        </p>
      )}
    </details>
  );
}
