"use client";

import { FaCoins } from "react-icons/fa";

interface Props {
  amount: number;
  onChange: (next: number) => void;
  disabled: boolean;
}

const ADD_STEPS = [0.01, 0.1, 1, 10, 100] as const;

function clamp(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 100_000) return 100_000;
  return Math.round(n * 100) / 100;
}

export default function BettingControls({ amount, onChange, disabled }: Props) {
  const set = (next: number) => onChange(clamp(next));

  return (
    <div className="flex flex-col items-stretch gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-center">
      <div className="flex flex-row p-2 bg-[#15161D] rounded-lg shadow-xl">
      <div className="flex flex-1 items-center gap-2 sm:max-w-md">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gold">
            <FaCoins />
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={Number.isFinite(amount) ? amount : 0}
            disabled={disabled}
            onChange={(e) => set(parseFloat(e.target.value))}
            className="w-full rounded-lg text-center py-2 pl-7 pr-3 font-mono text-base tabular-nums text-foreground outline-none focus:border-accent disabled:opacity-60"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <ControlButton onClick={() => set(0)} disabled={disabled}>
          CLEAR
        </ControlButton>
        {ADD_STEPS.map((step) => (
          <ControlButton
            key={step}
            onClick={() => set(amount + step)}
            disabled={disabled}
          >
            +{step}
          </ControlButton>
        ))}
        <ControlButton onClick={() => set(amount / 2)} disabled={disabled}>
          1/2
        </ControlButton>
        <ControlButton onClick={() => set(amount * 2)} disabled={disabled}>
          ×2
        </ControlButton>
        <ControlButton
          onClick={() => set(1000)}
          disabled={disabled}
        >
          MAX
        </ControlButton>
      </div>
      </div>
    </div>
  );
}

function ControlButton({
  children,
  onClick,
  disabled,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  variant?: "default" | "muted" | "gold";
}) {
  const styles =
    variant === "gold"
      ? "border-gold/40 bg-gold/10 text-gold hover:bg-gold/20"
      : variant === "muted"
        ? "border-border bg-panel-2 text-muted hover:text-foreground"
        : " text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}
