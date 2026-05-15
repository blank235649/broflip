export type CoinSide = "H" | "T";

export type Outcome = "HH" | "TT" | "MIXED";

export type GamePhase = "betting" | "flipping" | "result";

export type ColumnKey = "HH" | "MIXED" | "TT";

// 2% house edge: HH/TT each have probability 1/4 (fair = 4×), MIXED has 1/2 (fair = 2×).
export const COLUMN_MULTIPLIERS: Record<ColumnKey, number> = {
  HH: 3.92,
  MIXED: 1.96,
  TT: 3.92,
};

/** Theoretical house edge per bet — flat across all columns by construction. */
export const HOUSE_EDGE = 0.02;

/**
 * Affiliate revenue share. Affiliates earn AFFILIATE_RATE × HOUSE_EDGE on
 * every wager from referred users — i.e. 0.2% of stake per bet at current
 * settings. Paid on placement (independent of outcome), so revenue is
 * deterministic and never goes negative on a referrer's lucky streak.
 */
export const AFFILIATE_RATE = 0.10;

export interface Bet {
  id: string;
  userId: string;
  username: string;
  avatarHue: number;
  column: ColumnKey;
  amount: number;
  placedAt: number;
}

export interface RoundCommit {
  roundId: number;
  /** UTC date (YYYY-MM-DD) of the seed period this round belongs to. */
  periodDate: string;
  /** sha256(serverSeed) — the public commit. The seed itself is not revealed
   * until the period closes and is then available via /api/verify/{periodDate}/{nonce}. */
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export interface RoundReveal extends RoundCommit {
  coins: [CoinSide, CoinSide];
  outcome: Outcome;
}

export interface GameState {
  phase: GamePhase;
  roundId: number;
  /** Server epoch ms when the current phase ends. Client interpolates timeRemaining locally. */
  phaseEndsAt: number;
  /** Server's Date.now() at the moment of broadcast. Lets the client correct for clock skew. */
  serverNow: number;
  /** All bets placed in this round so far */
  bets: Bet[];
  /** Public commitment (hash of serverSeed) — revealed when the round resolves */
  commit: RoundCommit;
  /** Present once the round has been flipped */
  reveal: RoundReveal | null;
  /** Outcomes from the most recent rounds (newest first), capped at 100 */
  history: Outcome[];
}

export interface PlaceBetPayload {
  column: ColumnKey;
  amount: number;
}

export interface BetErrorPayload {
  reason: "insufficient_funds" | "invalid_bet" | "phase_closed" | "internal";
  message: string;
}

export interface BalanceUpdatePayload {
  balance: string; // numeric as string from the ledger
  totalWagered: string;
}

// Wire protocol — keep names short; these go over every socket frame.
export interface ServerToClientEvents {
  state: (state: GameState) => void;
  bet: (bet: Bet) => void;
  reveal: (reveal: RoundReveal) => void;
  roundStart: (commit: RoundCommit) => void;
  betError: (payload: BetErrorPayload) => void;
  balanceUpdate: (payload: BalanceUpdatePayload) => void;
}

export interface ClientToServerEvents {
  placeBet: (payload: PlaceBetPayload) => void;
}
