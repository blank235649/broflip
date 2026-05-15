"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAuthModal } from "./AuthModalContext";

const HAS_GOOGLE = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";

export default function AuthModal() {
  const router = useRouter();
  const search = useSearchParams();
  const { status } = useSession();
  const { open, tab, hide, setTab, show, referralCode } = useAuthModal();

  // Auto-open the register tab when an unauthenticated user lands at
  // /?ref=CODE — the standard "shared affiliate link" entry point.
  const refFromUrl = search.get("ref");
  useEffect(() => {
    if (!refFromUrl) return;
    if (status !== "unauthenticated") return;
    show("register", { referralCode: refFromUrl });
  }, [refFromUrl, status, show]);

  // Close on Escape and lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, hide]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4"
      onClick={hide}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-border bg-[#15161D] p-6 shadow-2xl"
      >
        <Tabs tab={tab} setTab={setTab} />
        {tab === "login" ? (
          <LoginForm onSuccess={successHandler(router, hide)} />
        ) : (
          <RegisterForm
            onSuccess={successHandler(router, hide)}
            initialReferralCode={referralCode}
          />
        )}
        <Divider />
        <SocialButtons onSuccess={successHandler(router, hide)} />
      </div>
    </div>
  );
}

function successHandler(
  router: ReturnType<typeof useRouter>,
  hide: () => void,
) {
  return () => {
    hide();
    router.refresh();
  };
}

function Tabs({ tab, setTab }: { tab: "login" | "register"; setTab: (t: "login" | "register") => void }) {
  return (
    <div className="mb-6 grid grid-cols-2 rounded-full bg-panel-2 p-1 text-sm">
      <button
        onClick={() => setTab("login")}
        className={`rounded-full py-2 transition ${
          tab === "login" ? "bg-panel font-semibold text-foreground" : "text-muted"
        }`}
      >
        Log In
      </button>
      <button
        onClick={() => setTab("register")}
        className={`rounded-full py-2 transition ${
          tab === "register" ? "bg-panel font-semibold text-foreground" : "text-muted"
        }`}
      >
        Register
      </button>
    </div>
  );
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setSubmitting(false);
    if (!res || res.error) {
      setError("invalid email or password");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field
        label="Email"
        type="email"
        placeholder="example@email.com"
        value={email}
        onChange={setEmail}
        required
      />
      <PasswordField
        label="Password"
        placeholder="Enter Password"
        value={password}
        onChange={setPassword}
        show={showPw}
        toggle={() => setShowPw((s) => !s)}
        required
      />
      <a className="self-end text-xs text-muted underline" href="#">
        Forgot Password?
      </a>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-gold py-2.5 text-sm font-bold text-black/80 disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Log In"}
      </button>
    </form>
  );
}

function RegisterForm({
  onSuccess,
  initialReferralCode = "",
}: {
  onSuccess: () => void;
  initialReferralCode?: string;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showRefField, setShowRefField] = useState(
    initialReferralCode.length > 0,
  );
  const [refCode, setRefCode] = useState(initialReferralCode);
  const [marketingOk, setMarketingOk] = useState(false);
  const [ageOk, setAgeOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ageOk) {
      setError("You must confirm you are at least 18.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        displayName: username,
        ref: refCode,
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "registration failed");
      setSubmitting(false);
      return;
    }
    const signed = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setSubmitting(false);
    if (!signed || signed.error) {
      setError("registered, but could not sign in — try logging in.");
      return;
    }
    void marketingOk; // not yet stored
    onSuccess();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field
        label="Username"
        required
        value={username}
        onChange={setUsername}
        placeholder="Username"
        labelMark
        maxLength={32}
      />
      <Field
        label="Email"
        required
        labelMark
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="example@email.com"
      />
      <PasswordField
        label="Password"
        required
        labelMark
        value={password}
        onChange={setPassword}
        show={showPw}
        toggle={() => setShowPw((s) => !s)}
        placeholder="Enter Password"
        minLength={8}
      />

      <Checkbox
        checked={showRefField}
        onChange={setShowRefField}
        label="Referral code (optional)"
      />
      {showRefField && (
        <input
          type="text"
          value={refCode}
          onChange={(e) => setRefCode(e.target.value.toUpperCase())}
          maxLength={32}
          placeholder="REFERRAL CODE"
          className="-mt-2 ml-7 rounded-md border border-border bg-panel-2 px-3 py-2 font-mono text-sm uppercase"
        />
      )}

      <Checkbox
        checked={marketingOk}
        onChange={setMarketingOk}
        label="I'd like to receive valuable promotions, bonuses or information via email"
      />
      <Checkbox
        checked={ageOk}
        onChange={setAgeOk}
        label={
          <>
            I confirm that I am at least 18 years old and agree to the{" "}
            <a className="underline" href="#">
              Terms &amp; Conditions
            </a>
          </>
        }
      />

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-gold py-2.5 text-sm font-bold text-black/80 disabled:opacity-60"
      >
        {submitting ? "Creating account…" : "Register"}
      </button>
    </form>
  );
}

function SocialButtons({ onSuccess }: { onSuccess: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <WalletButton onSuccess={onSuccess} />
      <GoogleButton onSuccess={onSuccess} />
    </div>
  );
}

function GoogleButton({ onSuccess }: { onSuccess: () => void }) {
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!HAS_GOOGLE) {
      alert("Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then set NEXT_PUBLIC_GOOGLE_ENABLED=true.");
      return;
    }
    setBusy(true);
    // Auth.js handles the redirect roundtrip itself. The callback URL
    // brings the user back to / where the session is now populated.
    await signIn("google", { callbackUrl: "/" });
    onSuccess();
  }
  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className="flex items-center justify-center gap-2 rounded-md border border-border bg-panel-2 py-2.5 text-sm font-medium hover:bg-panel disabled:opacity-60"
    >
      <GoogleIcon />
      Google
    </button>
  );
}

/**
 * Sign-in with Solana via the Wallet Adapter / Wallet Standard.
 *
 *   1. If no wallet is connected, open the wallet-adapter modal and let
 *      the user pick. Set a `pending` flag so the sign-in fires once the
 *      adapter reports `connected`.
 *   2. Once connected, fetch a nonce, ask the wallet to sign the canonical
 *      message, hand the signature to NextAuth's `solana` provider.
 *
 * Auto-discovers Phantom / Solflare / Backpack / Glow / Magic Eden / Trust
 * via the Wallet Standard. The `wallets={[]}` prop on WalletProvider is
 * intentional — explicit adapters were the pre-Wallet-Standard pattern and
 * are no longer needed for any modern wallet.
 */
function WalletButton({ onSuccess }: { onSuccess: () => void }) {
  const { wallet, publicKey, connected, signMessage, disconnect, wallets } =
    useWallet();
  const { setVisible } = useWalletModal();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set true when the user clicks Wallet but no wallet was selected yet.
  // The effect below picks up the connection once the adapter reports it.
  const pendingRef = useRef(false);

  const runSignIn = useCallback(
    async (address: string) => {
      if (!signMessage) {
        setError(
          "Selected wallet doesn't support message signing. Try a different one.",
        );
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const nonceRes = await fetch("/api/auth/solana-nonce", {
          method: "POST",
        });
        if (!nonceRes.ok) {
          setError("Could not start sign-in. Try again.");
          return;
        }
        const { nonce } = (await nonceRes.json()) as { nonce: string };

        const message = `Broflip wants you to sign in with your Solana account:
${address}

Sign this message to prove ownership. This will not trigger a transaction
or cost any gas.

Nonce: ${nonce}`;

        const signedBytes = await signMessage(new TextEncoder().encode(message));
        const signatureBase58 = bs58.encode(signedBytes);

        const res = await signIn("solana", {
          address,
          signature: signatureBase58,
          nonce,
          redirect: false,
        });
        if (!res || res.error) {
          setError("Wallet sign-in failed.");
          return;
        }
        onSuccess();
      } catch (err) {
        // User-rejected signing isn't an error worth surfacing as scary text.
        const msg = err instanceof Error ? err.message : "Wallet sign-in failed.";
        setError(/reject|denied|user/i.test(msg) ? null : msg);
      } finally {
        setBusy(false);
      }
    },
    [signMessage, onSuccess],
  );

  // Fire the sign-in once the adapter signals `connected` after a pending
  // pick. Without this the user-picks-wallet → connect happens async and
  // we'd otherwise have nowhere to plug back into the flow.
  useEffect(() => {
    if (!pendingRef.current) return;
    if (!connected || !publicKey) return;
    pendingRef.current = false;
    // runSignIn calls setBusy synchronously; defer to a microtask so the
    // setState lands outside this effect's tick (keeps the React Compiler
    // lint happy without changing semantics).
    queueMicrotask(() => {
      void runSignIn(publicKey.toBase58());
    });
  }, [connected, publicKey, runSignIn]);

  async function go() {
    setError(null);
    if (connected && publicKey) {
      await runSignIn(publicKey.toBase58());
      return;
    }
    if (wallets.length === 0) {
      setError(
        "No Solana wallet detected. Install Phantom, Solflare, Backpack, or any wallet that supports the Solana Wallet Standard.",
      );
      return;
    }
    pendingRef.current = true;
    setVisible(true);
  }

  return (
    <div className="contents">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-md border border-border bg-panel-2 py-2.5 text-sm font-medium hover:bg-panel disabled:opacity-60"
      >
        <span aria-hidden>👛</span>
        {busy ? "Signing…" : wallet ? "Sign in" : "Wallet"}
      </button>
      {connected && (
        <button
          type="button"
          onClick={() => disconnect()}
          className="col-span-2 text-center text-[11px] text-muted hover:text-foreground"
        >
          Disconnect {wallet?.adapter.name}
        </button>
      )}
      {error && (
        <p className="col-span-2 text-center text-xs text-rose-400">{error}</p>
      )}
    </div>
  );
}

function Divider() {
  return (
    <div className="my-5 flex items-center gap-3 text-[10px] tracking-widest text-muted">
      <div className="h-px flex-1 bg-border" />
      OR CONTINUE WITH
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

interface FieldProps {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  labelMark?: boolean;
  maxLength?: number;
}

function Field({ label, type = "text", value, onChange, placeholder, required, labelMark, maxLength }: FieldProps) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-bold uppercase tracking-widest text-muted">
        {label}
        {labelMark && <span className="ml-1 text-rose-400">*</span>}
      </span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="rounded-md border border-border bg-panel-2 px-3 py-2.5 placeholder:text-muted/60"
      />
    </label>
  );
}

function PasswordField(props: FieldProps & { show: boolean; toggle: () => void; minLength?: number }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-bold uppercase tracking-widest text-muted">
        {props.label}
        {props.labelMark && <span className="ml-1 text-rose-400">*</span>}
      </span>
      <div className="relative">
        <input
          type={props.show ? "text" : "password"}
          required={props.required}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          minLength={props.minLength}
          className="w-full rounded-md border border-border bg-panel-2 px-3 py-2.5 pr-10 placeholder:text-muted/60"
        />
        <button
          type="button"
          onClick={props.toggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
          aria-label={props.show ? "Hide password" : "Show password"}
        >
          {props.show ? "🙈" : "👁"}
        </button>
      </div>
    </label>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-2 text-xs leading-snug">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
      />
      <span>{label}</span>
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.85h5.4c-.23 1.4-1.7 4.1-5.4 4.1a6.15 6.15 0 0 1 0-12.3c1.95 0 3.25.83 4 1.55l2.7-2.6C16.95 3.2 14.7 2.2 12 2.2 6.95 2.2 2.85 6.3 2.85 11.35S6.95 20.5 12 20.5c6.9 0 9.45-4.85 9.45-9.3 0-.6-.05-1.1-.15-1.6Z"
      />
    </svg>
  );
}
