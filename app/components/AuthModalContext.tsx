"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type Tab = "login" | "register";

interface AuthModalState {
  open: boolean;
  tab: Tab;
  /** Prefilled referral code on the register tab. Empty when none. */
  referralCode: string;
  show: (tab?: Tab, opts?: { referralCode?: string }) => void;
  hide: () => void;
  setTab: (tab: Tab) => void;
}

const AuthModalContext = createContext<AuthModalState | null>(null);

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("login");
  const [referralCode, setReferralCode] = useState("");

  const show = useCallback(
    (next?: Tab, opts?: { referralCode?: string }) => {
      if (next) setTab(next);
      if (opts?.referralCode !== undefined) setReferralCode(opts.referralCode);
      setOpen(true);
    },
    [],
  );
  const hide = useCallback(() => setOpen(false), []);

  return (
    <AuthModalContext.Provider
      value={{ open, tab, referralCode, show, hide, setTab }}
    >
      {children}
    </AuthModalContext.Provider>
  );
}

export function useAuthModal(): AuthModalState {
  const ctx = useContext(AuthModalContext);
  if (!ctx) throw new Error("useAuthModal must be used inside AuthModalProvider");
  return ctx;
}
