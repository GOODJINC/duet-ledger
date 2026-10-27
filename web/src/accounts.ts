import type { Account } from "./api";

// UI eligibility only; the server authorizes every write independently.
export function isWritableAccount(account: Account) {
  return !account.archived && account.role !== "viewer";
}
