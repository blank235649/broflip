"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useBalance } from "../components/BalanceContext";
import { useAuthModal } from "../components/AuthModalContext";

interface DepositInfo {
  address: string;
  accountIndex: number;
  network: string;
  solUsdPrice: number;
  pendingOnChain: { lamports: number; sol: string; usd: number } | null;
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

interface CreditedDeposit {
  signature: string;
  amountSol: string;
  amountUsd: string;
  slot: number;
}

export default function DepositPage() {
  const { status } = useSession();
  const { refreshBalance } = useBalance();
  const [info, setInfo] = useState<DepositInfo | null>(null);
  const [scanning, setScanning] = useState(false);
  const [credited, setCredited] = useState<CreditedDeposit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/deposit", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DepositInfo | null) => {
        if (!cancelled && data) setInfo(data);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function refreshOnChain() {
    const res = await fetch("/api/deposit", { cache: "no-store" });
    if (res.ok) setInfo((await res.json()) as DepositInfo);
  }

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/deposit/scan", { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | { credited?: CreditedDeposit[]; error?: string }
        | null;
      if (!res.ok) {
        setError(data?.error ?? "scan failed");
        return;
      }
      setCredited(data?.credited ?? []);
      if (data?.credited?.length) void refreshBalance();
      void refreshOnChain();
    } finally {
      setScanning(false);
    }
  }

  async function copy() {
    if (!info) return;
    await navigator.clipboard.writeText(info.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (status === "loading") {
    return <main className="p-10 text-muted">Loading…</main>;
  }
  if (status !== "authenticated") {
    return <LoggedOutCta message="Log in to view your deposit address." />;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/" className="text-xs text-muted hover:text-foreground">
        ← back
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Deposit SOL</h1>
      <p className="mt-1 text-sm text-muted">
        Send SOL to the address below. Your USD balance is credited at{" "}
        <span className="font-mono">
          ${info?.solUsdPrice.toFixed(2) ?? "…"}
        </span>{" "}
        per SOL once confirmed.
      </p>

      {info && (
        <section className="mt-6 grid gap-4">
          <div className="rounded-md border border-border bg-panel/40 px-3 py-3">
            <div className="text-xs uppercase tracking-widest text-muted">
              Network
            </div>
            <div className="mt-1 font-mono text-sm">{info.network}</div>
          </div>

          <div className="rounded-md border border-border bg-panel/40 px-3 py-3">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-widest text-muted">
                Your deposit address
              </div>
              <button
                onClick={copy}
                className="text-xs text-accent hover:underline"
              >
                {copied ? "copied" : "copy"}
              </button>
            </div>
            <div className="mt-1 break-all font-mono text-sm">{info.address}</div>
            <img
              alt="QR for deposit address"
              className="mx-auto mt-3 h-48 w-48 rounded-md border border-border bg-white p-2"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(info.address)}`}
            />
            <p className="mt-2 text-center text-[11px] text-muted">
              Derivation index {info.accountIndex} · m/44&apos;/501&apos;/
              {info.accountIndex}&apos;/0&apos;
            </p>
          </div>

          {info.pendingOnChain && info.pendingOnChain.lamports > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              On-chain balance:{" "}
              <span className="font-mono">{info.pendingOnChain.sol} SOL</span> (~$
              {info.pendingOnChain.usd.toFixed(2)}) — click scan to credit.
            </div>
          )}

          <button
            onClick={scan}
            disabled={scanning}
            className="rounded-lg bg-gold py-2 text-sm font-bold text-black disabled:opacity-60"
          >
            {scanning ? "Scanning…" : "Scan for new deposits"}
          </button>

          {error && (
            <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          )}

          {credited.length > 0 && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
              Credited {credited.length} deposit
              {credited.length === 1 ? "" : "s"} totalling{" "}
              <span className="font-mono">
                $
                {credited
                  .reduce((s, c) => s + Number(c.amountUsd), 0)
                  .toFixed(2)}
              </span>
              .
            </div>
          )}
        </section>
      )}
    </main>
  );
}
