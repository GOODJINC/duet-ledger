import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { msg, getLocale, useLocale, setLocale as setLanguage } from "./i18n";
import { api, setCSRF, APIError, type User } from "./api";
import { Brand, Icon, ErrorText } from "./ui";
import { Auth } from "./auth";
import { Application } from "./app";
import "./app.css";

const initialInvite = location.hash.startsWith("#invite=")
  ? location.hash.slice(8)
  : "";
if (initialInvite) history.replaceState(null, "", location.pathname);

function Root() {
  useLocale();
  useEffect(() => setLanguage(getLocale()), []);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(true);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState(initialInvite);
  const [joined, setJoined] = useState(false);
  const boot = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const s = await api<{ initialized: boolean; registration_open: boolean }>(
        "/status",
      );
      setInitialized(s.initialized);
      setRegistrationOpen(s.registration_open);
      if (s.initialized) {
        try {
          const u = await api<User>("/me");
          setCSRF(u.csrf);
          setLanguage(u.locale);
          setUser(u);
        } catch (e) {
          if (!(e instanceof APIError && e.status === 401)) throw e;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : msg("연결하지 못했어요."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    boot();
    const logout = () => {
      setUser(null);
      setCSRF("");
      api<{ initialized: boolean; registration_open: boolean }>("/status")
        .then((s) => {
          setInitialized(s.initialized);
          setRegistrationOpen(s.registration_open);
        })
        .catch(() => {});
    };
    window.addEventListener("duet-ledger:unauthorized", logout);
    return () => window.removeEventListener("duet-ledger:unauthorized", logout);
  }, []);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  if (loading)
    return (
      <div className="boot-screen">
        <Brand />
        <Icon name="loader" className="spin" />
        <p>{msg("나의 기록을 준비하고 있어요.")}</p>
      </div>
    );
  if (error)
    return (
      <div className="boot-screen">
        <Brand />
        <ErrorText error={error} />
        <button className="primary-button" onClick={boot}>
          {msg("다시 연결")}
        </button>
      </div>
    );
  if (!user)
    return (
      <Auth
        initialized={initialized}
        registrationOpen={registrationOpen}
        invite={invite}
        onLogin={(u, isJoin) => {
          setCSRF(u.csrf);
          setLanguage(u.locale);
          setUser(u);
          setInitialized(true);
          if (isJoin) {
            setInvite("");
            setJoined(!!u.sharing_pending);
          }
        }}
      />
    );
  return (
    <Application
      user={user}
      setUser={setUser}
      invite={invite}
      clearInvite={() => setInvite("")}
      joined={joined}
    />
  );
}
const rootElement = document.getElementById("root");
if (rootElement) createRoot(rootElement).render(<Root />);
