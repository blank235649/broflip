import { createHash, createHmac, randomBytes } from "node:crypto";
import type { CoinSide, Outcome } from "./types";

export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function hashServerSeed(serverSeed: string): string {
  return createHash("sha256").update(serverSeed).digest("hex");
}

/**
 * Derives two coin sides from HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`).
 * Each coin uses one byte: low bit picks H/T. Two independent bytes → independent flips.
 */
export function flipCoins(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): [CoinSide, CoinSide] {
  const hmac = createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest();

  return [byteToSide(hmac[0]), byteToSide(hmac[1])];
}

function byteToSide(byte: number): CoinSide {
  return (byte & 1) === 0 ? "H" : "T";
}

export function outcomeFor(coins: [CoinSide, CoinSide]): Outcome {
  if (coins[0] === "H" && coins[1] === "H") return "HH";
  if (coins[0] === "T" && coins[1] === "T") return "TT";
  return "MIXED";
}

/**
 * Verifier — clients can re-run this against the published serverSeed/clientSeed/nonce
 * after a round to confirm the result wasn't tampered with.
 */
export function verifyRound(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  expectedHash: string,
): { valid: boolean; coins: [CoinSide, CoinSide]; outcome: Outcome } {
  const valid = hashServerSeed(serverSeed) === expectedHash;
  const coins = flipCoins(serverSeed, clientSeed, nonce);
  return { valid, coins, outcome: outcomeFor(coins) };
}
