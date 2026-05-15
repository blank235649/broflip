"use client";

import { useSession } from "next-auth/react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Identity = {
  username: string;
  avatarHue: number;
};

type Delta = { amount: number; key: number } | null;

interface BalanceContextValue {
  balance: number;
  setBalance: (updater: number | ((prev: number) => number)) => void;
  totalWagered: number;
  setTotalWagered: (n: number) => void;
  lastDelta: Delta;
  setLastDelta: (delta: Delta) => void;
  identity: Identity;
  refreshBalance: () => Promise<void>;
  /** Local override after a profile rename so the UI updates instantly. */
  setDisplayName: (name: string) => void;
}

const BalanceContext = createContext<BalanceContextValue | null>(null);

function makeAnonIdentity(): Identity {
  const adjectives = ["Lucky", "Nervous", "Cool", "Wild", "Sneaky", "Big", "Tiny", "Spicy"];
  const animals = ["Otter", "Falcon", "Badger", "Yak", "Toad", "Lynx", "Stoat", "Moose"];
  const a = adjectives[Math.floor(Math.random() * adjectives.length)];
  const b = animals[Math.floor(Math.random() * animals.length)];
  return {
    username: `${a}${b}${Math.floor(Math.random() * 100)}`,
    avatarHue: Math.floor(Math.random() * 360),
  };
}

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

export function BalanceProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [balance, setBalance] = useState<number>(0);
  const [totalWagered, setTotalWagered] = useState<number>(0);
  const [lastDelta, setLastDelta] = useState<Delta>(null);
  // displayName is authoritative from /api/balance; setDisplayName lets the
  // profile rename flow apply an instant optimistic update.
  const [displayName, setDisplayName] = useState<string | null>(null);
  const anonIdentity = useMemo(() => makeAnonIdentity(), []);
  const userId = session?.user?.id;
  const email = session?.user?.email;

  // Prefer the DB display_name; fall back to email prefix while the first
  // fetch is in flight; anonymous viewers get a random fun handle.
  const identity: Identity = email
    ? {
        username: displayName ?? email.split("@")[0],
        avatarHue: hashHue(email),
      }
    : anonIdentity;

  async function refreshBalance(): Promise<void> {
    if (!userId) {
      setBalance(0);
      setTotalWagered(0);
      setDisplayName(null);
      return;
    }
    const res = await fetch("/api/balance", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      balance: string;
      totalWagered: string;
      displayName?: string;
    };
    setBalance(Number(data.balance));
    setTotalWagered(Number(data.totalWagered));
    if (data.displayName) setDisplayName(data.displayName);
  }

  useEffect(() => {
    if (status === "loading") return;
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBalance(0);
      setTotalWagered(0);
      setDisplayName(null);
      return;
    }
    let cancelled = false;
    fetch("/api/balance", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: {
          balance: string;
          totalWagered: string;
          displayName?: string;
        } | null) => {
          if (cancelled || !data) return;
          setBalance(Number(data.balance));
          setTotalWagered(Number(data.totalWagered));
          if (data.displayName) setDisplayName(data.displayName);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [status, userId]);

  const value: BalanceContextValue = {
    balance,
    setBalance,
    totalWagered,
    setTotalWagered,
    lastDelta,
    setLastDelta,
    identity,
    refreshBalance,
    setDisplayName,
  };

  return <BalanceContext.Provider value={value}>{children}</BalanceContext.Provider>;
}

export function useBalance(): BalanceContextValue {
  const ctx = useContext(BalanceContext);
  if (!ctx) throw new Error("useBalance must be used inside BalanceProvider");
  return ctx;
}
