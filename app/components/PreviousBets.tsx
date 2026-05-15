"use client";

import type { Outcome } from "@/lib/types";

interface Props {
  history: Outcome[];
}

const RECENT_COUNT = 10;

export default function PreviousBets({ history }: Props) {
  const recent = history.slice(0, RECENT_COUNT);
  const last100 = history.slice(0, 100);
  const counts = { HH: 0, TT: 0, MIXED: 0 };
  for (const o of last100) counts[o]++;

  return (
    <div className="flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center justify-center">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted">
          Previous bets
        </span>
        <div className="flex items-center gap-3">
          {recent.length === 0 ? (
            <span className="text-xs text-muted">—</span>
          ) : (
            recent.map((o, i) => <OutcomeIcon key={i} outcome={o} />)
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted">
          Last 100
        </span>
        <div className="flex items-center gap-3">
          <CountBadge outcome="HH" count={counts.HH} />
          <CountBadge outcome="MIXED" count={counts.MIXED} />
          <CountBadge outcome="TT" count={counts.TT} />
        </div>
      </div>
    </div>
  );
}

function CountBadge({ outcome, count }: { outcome: Outcome; count: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <OutcomeIcon outcome={outcome} />
      <span className="font-mono text-xs tabular-nums text-foreground">
        {count}
      </span>
    </div>
  );
}

function OutcomeIcon({ outcome }: { outcome: Outcome }) {
  const left: CoinFace = outcome === "TT" ? "tails" : "heads";
  const right: CoinFace = outcome === "HH" ? "heads" : "tails";
  const label =
    outcome === "HH"
      ? "Two Heads"
      : outcome === "TT"
        ? "Two Tails"
        : "Heads & Tails";

  return (
    <div className="flex items-center gap-0.5" aria-label={label}>
      <MiniCoin face={left} />
      <MiniCoin face={right} />
    </div>
  );
}

type CoinFace = "heads" | "tails";

function MiniCoin({ face }: { face: CoinFace }) {
  const bg = face === "heads" ? "bg-[#d9b14a]" : "bg-[#c0c9d2]";
  const ring = face === "heads" ? "border-[#5d3e0e]" : "border-[#2f343d]";
  return (
    <div
      className={`relative grid h-5 w-5 place-items-center rounded-full ${bg} shadow-[inset_0_0_0_1px_rgba(0,0,0,0.25),inset_0_-3px_6px_rgba(0,0,0,0.35)]`}
    >
      <span
        className={`block h-[72%] w-[72%] rounded-full border border-dashed ${ring}`}
      />
    </div>
  );
}
