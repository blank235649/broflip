"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useAuthModal } from "../components/AuthModalContext";

interface Summary {
  referralCode: string | null;
  referredCount: number;
  affiliateBalance: string;
}

export default function AffiliatePage() {
  const { status } = useSession();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/affiliate", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Summary | null) => {
        if (!cancelled && data) setSummary(data);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function claim() {
    setClaiming(true);
    setMessage(null);
    const res = await fetch("/api/affiliate/claim", { method: "POST" });
    const data = (await res.json().catch(() => null)) as
      | { claimed?: string; error?: string }
      | null;
    if (res.ok && data?.claimed) {
      setMessage(`Claimed $${Number(data.claimed).toFixed(2)} into your wallet.`);
      // Refresh summary
      fetch("/api/affiliate", { cache: "no-store" })
        .then((r) => r.json())
        .then(setSummary);
    } else {
      setMessage(data?.error ?? "claim failed");
    }
    setClaiming(false);
  }

  if (status === "loading") {
    return <main className="p-10 text-muted">Loading…</main>;
  }
  if (status !== "authenticated") {
    return <LoggedOutCta message="Log in to view your affiliate dashboard." />;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/" className="text-xs text-muted hover:text-foreground">
        ← back
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Affiliate</h1>
      <p className="mt-1 text-sm text-muted">
        Earn 10% of the house edge on every bet placed by users who sign up
        under your code — paid on placement, win or lose.
      </p>

      {summary && (
        <section className="mt-6 grid gap-4">
          <div className="rounded-md border border-border bg-panel/40 px-3 py-3">
            <div className="text-xs uppercase tracking-widest text-muted">
              Your referral link
            </div>
            <div className="mt-1 break-all font-mono text-sm">
              {`${typeof window !== "undefined" ? window.location.origin : ""}/?ref=${summary.referralCode ?? ""}`}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stat label="Users referred" value={String(summary.referredCount)} />
            <Stat
              label="Affiliate balance"
              value={`$${Number(summary.affiliateBalance).toFixed(2)}`}
            />
          </div>

          <button
            onClick={claim}
            disabled={claiming || Number(summary.affiliateBalance) <= 0}
            className="rounded-lg bg-gold py-2 text-sm font-bold text-black disabled:opacity-60"
          >
            {claiming ? "Claiming…" : "Claim into wallet"}
          </button>
          {message && (
            <p className="text-center text-xs text-muted">{message}</p>
          )}
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-panel/40 px-3 py-3">
      <div className="text-xs uppercase tracking-widest text-muted">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
    </div>
  );
}

function LoggedOutCta({ message }: { message: string }) {
  const { show } = useAuthModal();
  return (
    <main className="grid place-items-center gap-3 p-10">
      <p className="text-muted">{message}</p>
      <button
        onClick={() => show("login")}
        className="rounded-lg border border-border px-4 py-2"
      >
        Log in
      </button>
    </main>
  );
}
