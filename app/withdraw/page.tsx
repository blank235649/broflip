"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useBalance } from "../components/BalanceContext";
import { useAuthModal } from "../components/AuthModalContext";

export default function WithdrawPage() {
  const { status } = useSession();
  const { balance, refreshBalance } = useBalance();
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{
    signature: string;
    amountSol: string;
    amountUsd: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toAddress, amountUsd: Number(amount) }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            signature?: string;
            amountSol?: string;
            amountUsd?: string;
            error?: string;
          }
        | null;
      if (!res.ok || !data?.signature) {
        setError(data?.error ?? "withdrawal failed");
        return;
      }
      setSuccess({
        signature: data.signature,
        amountSol: data.amountSol ?? "",
        amountUsd: data.amountUsd ?? "",
      });
      setToAddress("");
      setAmount("");
      void refreshBalance();
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return <main className="p-10 text-muted">Loading…</main>;
  }
  if (status !== "authenticated") {
    return <LoggedOutCta message="Log in to withdraw." />;
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <Link href="/" className="text-xs text-muted hover:text-foreground">
        ← back
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Withdraw SOL</h1>
      <p className="mt-1 text-sm text-muted">
        Available balance:{" "}
        <span className="font-mono">${balance.toFixed(2)}</span>
      </p>

      <form
        onSubmit={onSubmit}
        className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-panel/70 p-5"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Destination Solana address</span>
          <input
            type="text"
            required
            value={toAddress}
            onChange={(e) => setToAddress(e.target.value)}
            className="rounded-md border border-border bg-panel-2 px-3 py-2 font-mono text-xs"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Amount (USD)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            max={balance}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded-md border border-border bg-panel-2 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={submitting || !toAddress || !amount}
          className="rounded-lg bg-gold py-2 text-sm font-bold text-black disabled:opacity-60"
        >
          {submitting ? "Sending…" : "Send"}
        </button>

        {error && (
          <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        )}
        {success && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
            Sent ${success.amountUsd} (~{success.amountSol} SOL).
            <a
              className="ml-2 underline"
              target="_blank"
              rel="noreferrer"
              href={`https://explorer.solana.com/tx/${success.signature}?cluster=devnet`}
            >
              view tx
            </a>
          </div>
        )}
      </form>
    </main>
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
