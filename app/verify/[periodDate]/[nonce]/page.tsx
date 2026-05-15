import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { rounds, seedPeriods } from "@/lib/db/schema";
import { flipCoins, hashServerSeed, outcomeFor } from "@/lib/provablyFair";

export const runtime = "nodejs";

interface Props {
  params: Promise<{ periodDate: string; nonce: string }>;
}

export default async function VerifyPage({ params }: Props) {
  const { periodDate, nonce: nonceStr } = await params;
  const nonce = Number.parseInt(nonceStr, 10);
  if (!Number.isFinite(nonce) || nonce < 0) notFound();

  const [period] = await db
    .select()
    .from(seedPeriods)
    .where(eq(seedPeriods.periodDate, periodDate))
    .limit(1);
  if (!period) notFound();

  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.seedPeriodId, period.id))
    .limit(1);

  const revealed = period.revealedAt !== null;
  const derivedCoins = revealed
    ? flipCoins(period.serverSeed, period.clientSeed, nonce)
    : null;
  const derivedOutcome = derivedCoins ? outcomeFor(derivedCoins) : null;
  const hashValid = revealed
    ? hashServerSeed(period.serverSeed) === period.serverSeedHash
    : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/" className="text-xs text-muted hover:text-foreground">
        ← back to game
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Verify round</h1>
      <p className="mt-1 text-sm text-muted">
        {periodDate} · nonce {nonce}
      </p>

      <section className="mt-6 grid gap-4">
        <Field label="Period date" value={periodDate} />
        <Field label="Server seed hash (committed)" value={period.serverSeedHash} mono />
        <Field label="Client seed" value={period.clientSeed} mono />
        {revealed ? (
          <>
            <Field label="Server seed (revealed)" value={period.serverSeed} mono />
            <Field
              label="Hash of revealed seed matches commit?"
              value={hashValid ? "✓ yes" : "✗ no — tampered"}
              tone={hashValid ? "good" : "bad"}
            />
            <Field
              label="Recorded outcome"
              value={
                round
                  ? `${round.coinA}/${round.coinB} → ${round.outcome}`
                  : "no recorded round at this nonce"
              }
            />
            <Field
              label="Re-derived outcome (from revealed seeds)"
              value={
                derivedCoins
                  ? `${derivedCoins[0]}/${derivedCoins[1]} → ${derivedOutcome}`
                  : "—"
              }
              tone={
                round && derivedOutcome === round.outcome ? "good" : "bad"
              }
            />
          </>
        ) : (
          <p className="rounded-md border border-border bg-panel/40 px-3 py-3 text-sm text-muted">
            This period&apos;s server seed has not been revealed yet. Come back
            after midnight UTC to verify.
          </p>
        )}
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-400"
      : tone === "bad"
        ? "text-rose-400"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-panel/40 px-3 py-2">
      <div className="text-xs uppercase tracking-widest text-muted">{label}</div>
      <div className={`mt-1 break-all text-sm ${toneClass} ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}
