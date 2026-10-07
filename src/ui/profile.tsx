"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { BottomNavigation } from "./navigation";

type Account = { name?: string | null; email?: string | null; id?: string };
type Session = { user: Account } | null;

export function AccountIdentity({ account }: { account: Account }) {
  const name = account.name?.trim();
  const identifier = account.email?.trim() || account.id?.trim();
  return (
    <>
      {name && <p className="account-name">{name}</p>}
      <p>{identifier || "Signed in"}</p>
    </>
  );
}

export function ProfileScreen() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const mounted = useRef(false);
  const locked = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setAccount(null);
    try {
      const session = await api<Session>(
        "/api/auth/get-session?disableCookieCache=true",
      );
      if (!mounted.current) return;
      if (!session) {
        router.replace("/login");
        return;
      }
      setAccount(session.user);
    } catch {
      if (mounted.current) setLoadError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  async function signOut() {
    if (locked.current || !account) return;
    locked.current = true;
    setPending(true);
    setSignOutError(false);
    try {
      await api("/api/auth/logout", "POST");
      sessionStorage.clear();
      if (mounted.current) {
        setAccount(null);
        router.replace("/login");
      }
    } catch {
      if (mounted.current) setSignOutError(true);
    } finally {
      locked.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link href="/" className="brand">
          FITNESS <span>RPG</span>
        </Link>
      </header>
      <main id="main">
        <h1>Profile</h1>
        <section className="card profile-account" aria-label="Account">
          <h2>Account</h2>
          {loading ? (
            <div
              role="status"
              aria-label="Loading account"
              className="account-skeleton"
            >
              <span />
              <span />
            </div>
          ) : loadError ? (
            <>
              <p role="alert">Could not load your account. Please try again.</p>
              <button className="secondary" onClick={() => void load()}>
                Retry
              </button>
            </>
          ) : account ? (
            <AccountIdentity account={account} />
          ) : null}
          {account && (
            <button disabled={pending} onClick={() => void signOut()}>
              {pending ? "Signing out…" : "Sign out"}
            </button>
          )}
          {signOutError && (
            <p role="alert">Could not sign out. Please try again.</p>
          )}
        </section>
      </main>
      {account && <BottomNavigation screen="profile" />}
    </div>
  );
}
