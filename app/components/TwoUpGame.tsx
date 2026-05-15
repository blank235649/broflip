"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuthModal } from "./AuthModalContext";
import { io, type Socket } from "socket.io-client";
import {
  COLUMN_MULTIPLIERS,
  type Bet,
  type BetErrorPayload,
  type ClientToServerEvents,
  type ColumnKey,
  type GameState,
  type ServerToClientEvents,
} from "@/lib/types";
import CoinFlipArea from "./CoinFlipArea";
import BettingControls from "./BettingControls";
import BetColumn from "./BetColumn";
import PreviousBets from "./PreviousBets";
import { useBalance } from "./BalanceContext";
import { HH, HT, TT } from "../test/page";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001";

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;

export default function TwoUpGame() {
  const { data: session, status } = useSession();
  const { show } = useAuthModal();
  const isAuthed = status === "authenticated" && !!session?.user?.id;

  const socketRef = useRef<Sock | null>(null);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<GameState | null>(null);
  const [betAmount, setBetAmount] = useState<number>(1);
  const [betError, setBetError] = useState<BetErrorPayload | null>(null);
  const { balance, setBalance, setTotalWagered, setLastDelta } = useBalance();

  // serverOffset = serverNow - clientNow at the moment of receipt. Used by
  // useAnimatedRemaining to interpolate the countdown in the server's clock.
  const serverOffsetRef = useRef(0);
  const balanceRef = useRef(balance);
  useEffect(() => {
    balanceRef.current = balance;
  }, [balance]);

  useEffect(() => {
    if (status === "loading") return;

    let cancelled = false;
    let s: Sock | null = null;

    (async () => {
      let token: string | undefined;
      if (isAuthed) {
        const res = await fetch("/api/socket-ticket", { method: "POST" });
        if (res.ok) {
          const data = (await res.json()) as { token: string };
          token = data.token;
        } else {
          console.error("[broflip] socket ticket fetch failed", res.status);
        }
      }
      if (cancelled) return;

      s = io(SOCKET_URL, {
        transports: ["websocket"],
        auth: token ? { token } : undefined,
      });
      socketRef.current = s;

      s.on("connect", () => setConnected(true));
      s.on("disconnect", () => setConnected(false));
      s.on("connect_error", (err) => {
        console.error("[broflip] socket connect_error", err.message);
      });
      s.on("state", (next) => {
        // Anchor clock-skew offset on every state event. Cheap, drift-resistant.
        serverOffsetRef.current = next.serverNow - Date.now();
        setState(next);
      });
      s.on("bet", (bet) => {
        setState((prev) =>
          prev ? { ...prev, bets: [bet, ...prev.bets] } : prev,
        );
      });
      s.on("balanceUpdate", ({ balance: nextStr, totalWagered: wageredStr }) => {
        const next = Number(nextStr);
        const prev = balanceRef.current;
        const diff = round2(next - prev);
        if (diff !== 0) setLastDelta({ amount: diff, key: Date.now() });
        setBalance(next);
        setTotalWagered(Number(wageredStr));
      });
      s.on("betError", (payload) => {
        setBetError(payload);
      });
    })();

    return () => {
      cancelled = true;
      if (s) s.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [status, isAuthed, setBalance, setTotalWagered, setLastDelta]);

  function placeBet(column: ColumnKey) {
    if (!isAuthed) {
      show("login");
      return;
    }
    if (!socketRef.current || !state) return;
    if (state.phase !== "betting") return;
    if (!Number.isFinite(betAmount) || betAmount <= 0) return;
    setBetError(null);
    socketRef.current.emit("placeBet", { column, amount: betAmount });
  }

  const phase = state?.phase ?? "betting";
  const reveal = state?.reveal ?? null;
  const roundId = state?.roundId ?? 0;
  const canAfford =
    !isAuthed ||
    (Number.isFinite(betAmount) && betAmount > 0 && betAmount <= balance);

  // Smooth countdown — interpolate locally between server state events.
  // The animation runs at rAF (~60fps), independent of the network tick.
  const phaseEndsAt = state?.phaseEndsAt ?? 0;
  const timeRemaining = useAnimatedRemaining(phaseEndsAt, serverOffsetRef);

  const betsByColumn = useMemo(() => {
    const groups: Record<ColumnKey, Bet[]> = { HH: [], MIXED: [], TT: [] };
    for (const b of state?.bets ?? []) groups[b.column].push(b);
    return groups;
  }, [state?.bets]);

  return (
    <section className="flex flex-col gap-5">
      <CoinFlipArea
        phase={phase}
        roundId={roundId}
        timeRemainingMs={timeRemaining}
        reveal={reveal}
        connected={connected}
      />

      <PreviousBets history={state?.history ?? []} />

      <BettingControls
        amount={betAmount}
        onChange={setBetAmount}
        disabled={phase !== "betting" || !isAuthed}
      />

      {betError && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {betError.message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <BetColumn
          column="HH"
          props={<HH />}
          multiplier={COLUMN_MULTIPLIERS.HH}
          accent="from-accent/30 to-accent/0"
          tone="accent"
          bets={betsByColumn.HH}
          disabled={phase !== "betting" || !canAfford}
          onPlace={() => placeBet("HH")}
          highlight={reveal?.outcome === "HH"}
        />
        <BetColumn
          column="MIXED"
          props={<HT />}
          multiplier={COLUMN_MULTIPLIERS.MIXED}
          accent="from-gold/30 to-gold/0"
          tone="gold"
          bets={betsByColumn.MIXED}
          disabled={phase !== "betting" || !canAfford}
          onPlace={() => placeBet("MIXED")}
          highlight={reveal?.outcome === "MIXED"}
        />
        <BetColumn
          column="TT"
          props={<TT />}
          multiplier={COLUMN_MULTIPLIERS.TT}
          accent="from-rose-500/30 to-rose-500/0"
          tone="rose"
          bets={betsByColumn.TT}
          disabled={phase !== "betting" || !canAfford}
          onPlace={() => placeBet("TT")}
          highlight={reveal?.outcome === "TT"}
        />
      </div>

      {state && (
        <footer
          className="flex flex-col gap-1 rounded-xl border border-border bg-panel/40 px-4 py-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="font-mono">
            round #{state.roundId} · period {state.commit.periodDate} · seed hash{" "}
            <span className="text-foreground/80">
              {state.commit.serverSeedHash.slice(0, 16)}…
            </span>
          </div>
          <div className="font-mono">
            client seed{" "}
            <span className="text-foreground/80">{state.commit.clientSeed}</span>
            {reveal && (
              <Link
                href={`/verify/${state.commit.periodDate}/${reveal.nonce}`}
                className="ml-2 underline hover:text-foreground"
              >
                verify →
              </Link>
            )}
          </div>
        </footer>
      )}
    </section>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * requestAnimationFrame-driven countdown. Re-renders ~60× per second so the
 * timer is silky smooth even though the server only sends state events on
 * meaningful changes (bets, phase advances). serverOffset = serverNow -
 * clientNow, used to compute remaining time in the server's clock.
 */
function useAnimatedRemaining(
  phaseEndsAt: number,
  serverOffsetRef: React.RefObject<number>,
): number {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    // Defer the first setRemaining to the rAF callback rather than calling it
    // synchronously in the effect body — keeps React happy and avoids a
    // cascading render before the first frame paints.
    let raf = 0;
    const tick = () => {
      if (!phaseEndsAt) {
        setRemaining(0);
        return;
      }
      const now = Date.now() + (serverOffsetRef.current ?? 0);
      const next = Math.max(0, phaseEndsAt - now);
      setRemaining(next);
      if (next > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phaseEndsAt, serverOffsetRef]);

  return remaining;
}
