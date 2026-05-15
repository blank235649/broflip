"use client";

import type { CoinSide, GameState, RoundReveal } from "@/lib/types";

interface Props {
  phase: GameState["phase"];
  roundId: number;
  timeRemainingMs: number;
  reveal: RoundReveal | null;
  connected: boolean;
}

export default function CoinFlipArea({
  phase,
  roundId,
  timeRemainingMs,
  reveal,
  connected,
}: Props) {
  const seconds = (timeRemainingMs / 1000).toFixed(2);
  const betting = phase === "betting";

  const status = (() => {
    if (!connected) return { label: "CONNECTING", tone: "text-muted" };
    if (betting) return { label: "BETTING ENDS IN", tone: "text-foreground" };
    if (phase === "flipping") return { label: "FLIPPING", tone: "text-accent" };
    return { label: "RESULT", tone: "text-gold" };
  })();

  return (
    <div className="relative overflow-hidden rounded-2xl p-6 sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
      />

      <div className="relative flex flex-col items-center gap-4">

        <div className="relative">
          <div
            className={`flex items-center justify-center gap-10 transition-opacity duration-300 sm:gap-16 ${
              betting ? "opacity-30" : "opacity-100"
            }`}
          >
            <Coin
              key={`${roundId}-0`}
              side={reveal?.coins[0] ?? null}
              phase={phase}
              slot={0}
            />
            <Coin
              key={`${roundId}-1`}
              side={reveal?.coins[1] ?? null}
              phase={phase}
              slot={1}
            />
          </div>

          {betting && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
              <div className={`text-xs font-semibold tracking-[0.2em] ${status.tone}`}>
                {status.label}
              </div>
              <div className="mt-1 font-mono text-6xl font-semibold tabular-nums drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)] sm:text-7xl">
                {seconds}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function labelForOutcome([a, b]: [CoinSide, CoinSide]): string {
  if (a === "H" && b === "H") return "Two Heads";
  if (a === "T" && b === "T") return "Two Tails";
  return "Heads & Tails";
}

interface CoinProps {
  side: CoinSide | null;
  phase: GameState["phase"];
  slot: 0 | 1;
}

function Coin({ side, phase, slot }: CoinProps) {
  const flipping = phase === "flipping";
  const settled = phase === "result";
  const betting = phase === "betting";
  const finalSide: CoinSide = side ?? (slot === 0 ? "H" : "T");

  // restY = the rotation the coin should sit at when not actively flipping.
  // During betting, slot 1 sits at 180° so it shows tails (back face). During
  // flipping, we keep slot 1 at 180° as the start of the flip so it doesn't
  // visually snap from 180 → 0 at kickoff. After resolution, the rest matches
  // the actual outcome.
  const restY = settled
    ? finalSide === "T"
      ? 180
      : 0
    : slot === 1
      ? 180
      : 0;

  // Final flip angle. We choose target so target % 360 lands on 0 (heads) or
  // 180 (tails), and target ≥ restY + spins*360 so it always rotates forward
  // for visual consistency.
  const spins = slot === 0 ? 5 : 6;
  const desiredMod = finalSide === "T" ? 180 : 0;
  const targetDeg =
    restY + spins * 360 + ((desiredMod - restY + 360) % 360);

  const animClass = flipping
    ? "is-flipping"
    : betting
      ? "is-bobbing"
      : "";

  const style: React.CSSProperties = {
    ["--rest-rotation" as string]: `rotateY(${restY}deg)`,
    ...(flipping
      ? ({ "--coin-target": `${targetDeg}deg` } as React.CSSProperties)
      : {}),
  };

  return (
    <div
      className="relative h-28 w-28 sm:h-36 sm:w-36"
      style={{ perspective: "900px" }}
    >
      <div className={`coin3d ${animClass}`} style={style}>
        <div className="coin3d-face front">
          <span className="coin3d-circle" />
          <span className="coin3d-glyph"></span>
        </div>
        <div className="coin3d-face back">
          <span className="coin3d-circle" />
          <span className="coin3d-glyph"></span>
        </div>
        <CoinSides />
      </div>
    </div>
  );
}

function CoinSides() {
  const count = 20;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="coin3d-side"
          style={{
            transform: `translate3d(-50%, -50%, 0) rotateY(90deg) rotateX(${i * 18}deg) translateZ(var(--radius))`,
          }}
        />
      ))}
    </>
  );
}
