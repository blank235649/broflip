// Side-effect import — must come first. Loads .env.local into process.env
// before any other module (notably lib/db) reads from it. Imports are
// hoisted, so an inline call after a `dotenv` import wouldn't work.
import "../lib/loadEnv";

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { Server, type Socket } from "socket.io";
import {
  AFFILIATE_RATE,
  COLUMN_MULTIPLIERS,
  HOUSE_EDGE,
  type Bet,
  type ClientToServerEvents,
  type ColumnKey,
  type GameState,
  type Outcome,
  type RoundCommit,
  type RoundReveal,
  type ServerToClientEvents,
} from "../lib/types";
import { flipCoins, outcomeFor } from "../lib/provablyFair";
import { verifySocketTicket } from "../lib/socketAuth";
import {
  LedgerError,
  getUserState,
  payAffiliateShare,
  refundBet,
  reserveBet,
  settleBet,
} from "../lib/db/ledger";
import { ensureLedgerFunctions } from "../lib/db/setupFunctions";
import {
  getActiveSeedPeriod,
  recordRound,
  reserveNonce,
} from "../lib/db/seedPeriods";
import { db } from "../lib/db";
import { users } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { RateLimiter } from "../lib/rateLimit";

// Connection flood protection — keyed by client IP. 20 connect attempts per
// IP per 30s. Genuine reconnects after a network blip are well under this.
const connectLimiter = new RateLimiter(30 * 1000, 20);

// placeBet flood protection — keyed by userId. 30 bets per 10 seconds is
// fast enough that no human will hit it but stops a script from saturating
// the round. The phase already gates how many can land per round, but this
// also caps the database load from the ledger writes.
const betLimiter = new RateLimiter(10 * 1000, 30);

function socketIp(socket: Socket): string {
  const fwd = socket.handshake.headers["x-forwarded-for"];
  if (typeof fwd === "string") {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return socket.handshake.address || "unknown";
}

// Affiliates earn AFFILIATE_RATE × HOUSE_EDGE on every wager from referred
// users — i.e. ~0.2% of stake per bet at current settings. Paid out of the
// house account as `affiliate_share` on bet PLACEMENT, not settlement, so
// the affiliate's revenue is deterministic and never goes negative when the
// referred player happens to win.
const AFFILIATE_PER_WAGER = AFFILIATE_RATE * HOUSE_EDGE;

async function getReferrerUserId(userId: string): Promise<string | null> {
  if (referrerCache.has(userId)) return referrerCache.get(userId) ?? null;
  const [row] = await db
    .select({ referredById: users.referredById })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const referrer = row?.referredById ?? null;
  referrerCache.set(userId, referrer);
  return referrer;
}

const PORT = Number(process.env.SERVER_PORT ?? 3001);
const ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";

const BETTING_MS = 12_000;
const FLIP_MS = 3_500;
const RESULT_MS = 4_000;
// Phase-advance check interval. State broadcasts no longer happen on this
// tick — clients interpolate the countdown locally from phaseEndsAt — so
// we only need this often enough to land phase transitions promptly.
const TICK_MS = 200;
const MAX_BET = 100_000;

const app = express();
app.get("/healthz", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>(
  httpServer,
  { cors: { origin: ORIGIN, methods: ["GET", "POST"] } },
);

// userId/email are present once the socket has presented a valid ticket.
// Anonymous sockets (no ticket) connect read-only and cannot bet.
interface SocketData {
  userId?: string;
  email?: string;
  // Cached lifetime wager — refreshed on connect and on every successful
  // bet from the place_bet RETURNING. Used to stamp bet.level without an
  // extra DB lookup at bet time.
  totalWagered?: string;
}

// Cache referrer per user across the process lifetime — referrers don't
// change after signup. Keyed by userId, value is the referrer userId or null.
const referrerCache = new Map<string, string | null>();

type AuthedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  object,
  SocketData
>;

interface Round {
  id: number;
  // Each round borrows seed material from the active daily seed_period and
  // reserves its own nonce. The serverSeed stays SECRET for the duration of
  // the period — only the hash is broadcast — so revealing a round result
  // can't be used to predict subsequent rounds. Verification becomes possible
  // when the period closes (UTC midnight), at which point /api/verify
  // returns the now-public serverSeed.
  seedPeriodId: string;
  periodDate: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  bets: Bet[];
  reveal: RoundReveal | null;
}

async function newRound(prevId: number): Promise<Round> {
  const period = await getActiveSeedPeriod();
  const nonce = await reserveNonce(period.id);
  return {
    id: prevId + 1,
    seedPeriodId: period.id,
    periodDate: period.periodDate,
    serverSeed: period.serverSeed,
    serverSeedHash: period.serverSeedHash,
    clientSeed: period.clientSeed,
    nonce,
    bets: [],
    reveal: null,
  };
}

// Bootstrap-time placeholder. Replaced before the first state broadcast
// in start() — see the bottom of the file.
let round: Round = {
  id: 0,
  seedPeriodId: "",
  periodDate: "",
  serverSeed: "",
  serverSeedHash: "",
  clientSeed: "",
  nonce: 0,
  bets: [],
  reveal: null,
};
let phase: GameState["phase"] = "betting";
let phaseEndsAt = Date.now() + BETTING_MS;
let advancing = false;
const HISTORY_CAP = 100;
const history: Outcome[] = [];

function commitFor(r: Round): RoundCommit {
  return {
    roundId: r.id,
    periodDate: r.periodDate,
    serverSeedHash: r.serverSeedHash,
    clientSeed: r.clientSeed,
    nonce: r.nonce,
  };
}

function snapshot(): GameState {
  return {
    phase,
    roundId: round.id,
    phaseEndsAt,
    serverNow: Date.now(),
    bets: round.bets,
    commit: commitFor(round),
    reveal: round.reveal,
    history,
  };
}

function broadcastState() {
  io.emit("state", snapshot());
}

async function emitBalance(socket: AuthedSocket): Promise<void> {
  if (!socket.data.userId) return;
  try {
    const state = await getUserState(socket.data.userId);
    socket.data.totalWagered = state.totalWagered;
    socket.emit("balanceUpdate", {
      balance: state.balance,
      totalWagered: state.totalWagered,
    });
  } catch (err) {
    console.error("[broflip] balance fetch failed", err);
  }
}

/**
 * Push a balance update for a single socket using the cached totalWagered.
 * Used after a settle (where settle_bet returns just the new balance).
 */
function emitBalanceUpdate(socket: AuthedSocket, balance: string): void {
  const totalWagered = socket.data.totalWagered ?? "0";
  socket.emit("balanceUpdate", { balance, totalWagered });
}

async function resolveRound(): Promise<void> {
  const coins = flipCoins(round.serverSeed, round.clientSeed, round.nonce);
  const outcome = outcomeFor(coins);
  // Note: serverSeed is intentionally NOT included in the reveal payload —
  // it's the daily seed and can't be exposed mid-period. Players can verify
  // each round once the period closes via /api/verify/{periodDate}/{nonce}.
  round.reveal = {
    ...commitFor(round),
    coins,
    outcome,
  };

  history.unshift(outcome);
  if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;

  // Persist the round so /verify can show the recorded outcome and a
  // post-period verifier can confirm the seed-derived outcome matches.
  void recordRound({
    seedPeriodId: round.seedPeriodId,
    nonce: round.nonce,
    coins,
    outcome,
  }).catch((err) => console.error("[broflip] recordRound failed", err));

  // Settle every bet in parallel against the ledger. Each bet has its own
  // idempotency key so partial failures can be retried. We collect the
  // post-settle balances and broadcast them all at once after the reveal.
  const winningColumn: ColumnKey = outcome;
  const newBalances = new Map<string, string>();

  await Promise.all(
    round.bets.map(async (bet) => {
      const won = bet.column === winningColumn;
      const multiplier = COLUMN_MULTIPLIERS[bet.column];
      try {
        const result = await settleBet({
          betId: bet.id,
          userId: bet.userId,
          amount: bet.amount.toFixed(2),
          multiplier,
          won,
          roundId: round.id,
        });
        if (result.userBalance !== null) {
          newBalances.set(bet.userId, result.userBalance);
        }
        // Affiliate share is paid on bet PLACEMENT (deterministic edge share),
        // not at settlement — so nothing affiliate-related happens here.
      } catch (err) {
        console.error(`[broflip] settle failed for bet ${bet.id}`, err);
      }
    }),
  );

  io.emit("reveal", round.reveal);

  // Push the new balance to each affected user's connected sockets.
  // No DB query — we already have the value from settleBet's RETURNING.
  // Level comes from the cached totalWagered on the socket — settle doesn't
  // change wagered (that already happened on placeBet).
  if (newBalances.size > 0) {
    for (const [, socket] of io.sockets.sockets) {
      const auth = socket as AuthedSocket;
      const userId = auth.data?.userId;
      if (!userId) continue;
      const balance = newBalances.get(userId);
      if (balance !== undefined) emitBalanceUpdate(auth, balance);
    }
  }
}

async function advancePhase(): Promise<void> {
  if (phase === "betting") {
    phase = "flipping";
    phaseEndsAt = Date.now() + FLIP_MS;
    await resolveRound();
  } else if (phase === "flipping") {
    phase = "result";
    phaseEndsAt = Date.now() + RESULT_MS;
  } else {
    round = await newRound(round.id);
    phase = "betting";
    phaseEndsAt = Date.now() + BETTING_MS;
    io.emit("roundStart", commitFor(round));
  }
  broadcastState();
}

function startTickLoop(): void {
  setInterval(() => {
    if (advancing) return;
    if (Date.now() >= phaseEndsAt) {
      advancing = true;
      advancePhase()
        .catch((err) => console.error("[broflip] advancePhase failed", err))
        .finally(() => {
          advancing = false;
        });
    }
    // No periodic state broadcast — state only changes on bets, reveals, and
    // phase advances, and each of those emits explicitly. The countdown is
    // computed client-side from phaseEndsAt.
  }, TICK_MS);
}

// Connection rate limit — fires before any handshake work.
io.use((socket, next) => {
  const ip = socketIp(socket);
  if (!connectLimiter.check(ip).allowed) {
    return next(new Error("rate limited"));
  }
  next();
});

// Socket auth middleware — if a ticket is provided, verify it and attach
// userId/email. No ticket = anonymous read-only connection (can watch the
// game but can't bet). An *invalid* ticket is still rejected.
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) return next();
  try {
    const ticket = await verifySocketTicket(token);
    (socket as AuthedSocket).data.userId = ticket.userId;
    (socket as AuthedSocket).data.email = ticket.email;
    next();
  } catch (err) {
    console.warn("[broflip] socket auth failed", err);
    next(new Error("invalid socket ticket"));
  }
});

io.on("connection", (raw) => {
  const socket = raw as AuthedSocket;
  socket.emit("state", snapshot());
  void emitBalance(socket);

  socket.on("placeBet", async (payload) => {
    if (!socket.data.userId || !socket.data.email) {
      socket.emit("betError", {
        reason: "invalid_bet",
        message: "log in to place bets",
      });
      return;
    }
    if (!betLimiter.check(socket.data.userId).allowed) {
      socket.emit("betError", {
        reason: "invalid_bet",
        message: "slow down — too many bets",
      });
      return;
    }
    if (phase !== "betting") {
      socket.emit("betError", { reason: "phase_closed", message: "betting is closed" });
      return;
    }
    const amount = Number(payload?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_BET) {
      socket.emit("betError", { reason: "invalid_bet", message: "amount out of range" });
      return;
    }
    if (!(payload.column in COLUMN_MULTIPLIERS)) {
      socket.emit("betError", { reason: "invalid_bet", message: "invalid column" });
      return;
    }

    const rounded = roundTo(amount, 2);
    const userId = socket.data.userId;
    const email = socket.data.email;
    const bet: Bet = {
      id: randomUUID(),
      userId,
      username: email.split("@")[0],
      avatarHue: hashHue(email),
      column: payload.column,
      amount: rounded,
      placedAt: Date.now(),
    };

    let userBalance: string;
    let newTotalWagered: string;
    try {
      const result = await reserveBet({
        betId: bet.id,
        userId: bet.userId,
        amount: rounded.toFixed(2),
        roundId: round.id,
        column: bet.column,
      });
      userBalance = result.userBalance;
      newTotalWagered = result.totalWagered;
    } catch (err) {
      if (err instanceof LedgerError && err.code === "insufficient_funds") {
        socket.emit("betError", {
          reason: "insufficient_funds",
          message: "insufficient balance",
        });
        return;
      }
      console.error("[broflip] reserveBet failed", err);
      socket.emit("betError", { reason: "internal", message: "could not place bet" });
      return;
    }

    // Update the cached wagered AFTER the ledger write so the next bet
    // (and any subsequent emitBalanceUpdate) sees the new level.
    socket.data.totalWagered = newTotalWagered;

    // Phase may have rolled over while we were reserving. If so, refund the
    // stake — otherwise we'd hold the user's money in escrow with no round
    // to settle against.
    if (phase !== "betting") {
      try {
        const refund = await refundBet({
          betId: bet.id,
          userId: bet.userId,
          amount: rounded.toFixed(2),
        });
        emitBalanceUpdate(socket, refund.userBalance);
      } catch (err) {
        console.error("[broflip] refundBet failed for orphaned bet", err);
      }
      socket.emit("betError", {
        reason: "phase_closed",
        message: "round closed before bet landed — refunded",
      });
      return;
    }

    round.bets.push(bet);
    io.emit("bet", bet);
    emitBalanceUpdate(socket, userBalance);

    // Affiliate edge share — fire-and-forget. Idempotent on `affiliate:<betId>`
    // so retries are safe. We pay every placed bet (deterministic edge share)
    // rather than only losses, so referrer earnings don't swing with luck.
    void payAffiliateShareIfReferred(bet.userId, bet.id, rounded);
  });
});

async function payAffiliateShareIfReferred(
  userId: string,
  betId: string,
  stake: number,
): Promise<void> {
  const referrerId = await getReferrerUserId(userId);
  if (!referrerId) return;
  const share = (stake * AFFILIATE_PER_WAGER).toFixed(8);
  // Skip vanishingly small shares — postLedger is balanced down to 1e-8 but
  // the row is noise below 1 satoshi.
  if (Number(share) <= 0) return;
  try {
    await payAffiliateShare({
      betId,
      referrerUserId: referrerId,
      amount: share,
    });
  } catch (err) {
    console.error(`[broflip] affiliate share failed for bet ${betId}`, err);
  }
}

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

async function start(): Promise<void> {
  // Stored functions installed before accepting any traffic so the first bet
  // doesn't pay the install round-trip.
  await ensureLedgerFunctions();
  // Mint round 1 against the active seed period before the tick loop fires.
  round = await newRound(0);
  phase = "betting";
  phaseEndsAt = Date.now() + BETTING_MS;

  startTickLoop();
  httpServer.listen(PORT, () => {
    console.log(`[broflip] socket.io server listening on :${PORT}`);
  });
}

start().catch((err) => {
  console.error("[broflip] startup failed", err);
  process.exit(1);
});
