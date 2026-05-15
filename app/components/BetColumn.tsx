"use client";

import type { Bet, ColumnKey } from "@/lib/types";

interface Props {
  column: ColumnKey;
  props: React.ReactNode;
  multiplier: number;
  accent: string;
  tone: "accent" | "gold" | "rose";
  bets: Bet[];
  disabled: boolean;
  highlight?: boolean;
  onPlace: () => void;
}

const TONE_BUTTON: Record<Props["tone"], string> = {
  accent:
    "bg-accent text-white hover:brightness-110 ring-1 ring-accent/40 shadow-[0_8px_24px_-8px_rgba(59,130,246,0.6)]",
  gold:
    "bg-gold text-black hover:brightness-110 ring-1 ring-gold/40 shadow-[0_8px_24px_-8px_rgba(245,180,0,0.6)]",
  rose:
    "bg-rose-500 text-white hover:brightness-110 ring-1 ring-rose-500/40 shadow-[0_8px_24px_-8px_rgba(244,63,94,0.6)]",
};

const TONE_BORDER: Record<Props["tone"], string> = {
  accent: "border-accent/40",
  gold: "border-gold/40",
  rose: "border-rose-500/40",
};

export default function BetColumn({
  props,
  multiplier,
  accent,
  tone,
  bets,
  disabled,
  highlight,
  onPlace,
}: Props) {
  const total = bets.reduce((s, b) => s + b.amount, 0);

  return (
    <>
    <div className="flex flex-col gap-2"> 

    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl bg-[#15161D] transition-shadow shadow-xl`}
    >
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-32`} />

      <div className="relative flex flex-col gap-3 p-4">
        <button type="button" className="grid grid-cols-3 items-center gap-3" onClick={onPlace}>
          <div className="justify-self-start">
            {props}
          </div>
          <h1
            className={`justify-self-center flex flex-nowrap rounded-lg py-3 text-sm font-bold tracking-widest transition disabled:cursor-not-allowed disabled:opacity-60`}
          >
            PLACE BET
          </h1>
          <div className="justify-self-end rounded-md px-2 py-1 font-mono text-sm font-bold">
            <span className="text-foreground">{multiplier}×</span>
          </div>
        </button>
      </div>
    </div>


     <div className="flex items-center justify-between rounded-md px-3 py-2 text-xs">
          <span className="text-muted">
            <span className="font-semibold text-foreground">{bets.length}</span>{" "}
            bets
          </span>
          <span className="font-mono tabular-nums text-gold">
            ${total.toFixed(2)}
          </span>
        </div> 

      <div className="relative max-h-72 overflow-y-auto px-3 pb-3 bg-[#15161D] shadow-xl rounded-lg">
        {bets.length === 0 ? (
          <div className="grid place-items-center py-8 text-xs text-muted">
            No bets yet
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {bets.map((bet) => (
              <BetRow key={bet.id} bet={bet} />
            ))}
          </ul>
        )}
      </div> 

      </div>
      </>
  );
}

function BetRow({ bet }: { bet: Bet }) {
  return (
    <li className="bet-in flex items-center justify-between gap-2 rounded-md bg-panel-2/60 px-2 py-1.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <Avatar hue={bet.avatarHue} initial={bet.username[0] ?? "?"} />
        <span className="truncate font-medium text-foreground">
          {bet.username}
        </span>
      </div>
      <span className="font-mono tabular-nums text-gold">
        ${bet.amount.toFixed(2)}
      </span>
    </li>
  );
}

function Avatar({ hue, initial }: { hue: number; initial: string }) {
  const bg = `hsl(${hue} 60% 40%)`;
  const ring = `hsl(${hue} 60% 60%)`;
  return (
    <div
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold uppercase"
      style={{ background: bg, boxShadow: `inset 0 0 0 1px ${ring}` }}
    >
      {initial}
    </div>
  );
}
