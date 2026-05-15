"use client";

import { useState } from "react";

interface SweepEntry {
  accountIndex: number;
  address: string;
  lamportsSwept: number;
  signature: string;
}

export default function SweepClient({ house }: { house: string }) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SweepEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/sweep", { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | { swept?: SweepEntry[]; error?: string }
        | null;
      if (!res.ok || !data?.swept) {
        setError(data?.error ?? "sweep failed");
        return;
      }
      setResults(data.swept);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section>
      <h1 className="text-xl font-semibold">Sweep child wallets</h1>
      <p className="mt-1 text-sm text-muted">
        Forwards every user&apos;s on-chain SOL balance to the house wallet,
        less the network fee buffer. Wallets below 0.0001 SOL are skipped.
      </p>
      <div className="mt-4 rounded-md border border-border bg-panel/40 px-3 py-2 font-mono text-xs">
        House → <span className="break-all">{house}</span>
      </div>

      <button
        onClick={run}
        disabled={running}
        className="mt-4 rounded-lg bg-gold px-4 py-2 text-sm font-bold text-black disabled:opacity-60"
      >
        {running ? "Sweeping…" : "Run sweep"}
      </button>

      {error && (
        <p className="mt-4 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}

      {results && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
            Result ({results.length} swept)
          </h2>
          {results.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing above threshold.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-2">Idx</th>
                  <th>Address</th>
                  <th>Lamports</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.signature} className="border-b border-border/40">
                    <td className="py-2 font-mono">{r.accountIndex}</td>
                    <td className="break-all font-mono text-xs">
                      {r.address.slice(0, 8)}…{r.address.slice(-6)}
                    </td>
                    <td className="font-mono tabular-nums">
                      {r.lamportsSwept.toLocaleString()}
                    </td>
                    <td>
                      <a
                        className="text-xs text-accent underline"
                        target="_blank"
                        rel="noreferrer"
                        href={`https://explorer.solana.com/tx/${r.signature}?cluster=devnet`}
                      >
                        view
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </section>
  );
}
