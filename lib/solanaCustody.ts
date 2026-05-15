import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { mnemonicToSeedSync, validateMnemonic } from "bip39";
import { derivePath } from "ed25519-hd-key";

/*
 * SECURITY: this module reads SOLANA_MNEMONIC out of process.env. That secret
 * is the seed for every wallet on the platform — house + every user's
 * deposit address. Anyone who learns it can drain everything. Acceptable
 * for solo dev against devnet. Before mainnet:
 *
 *   - Move signing to an HSM / threshold wallet (Fireblocks, Turnkey, Privy).
 *   - Keep <5% of liabilities on this hot path; the rest in cold storage
 *     swept manually or via multisig.
 *   - Audit every tool that has access to this Node process.
 */

const MNEMONIC = process.env.SOLANA_MNEMONIC;
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const SOL_USD_PRICE = Number(process.env.SOL_USD_PRICE ?? "200");

/** Coin type 501 is Solana per SLIP-44. Standard derivation path. */
function pathFor(accountIndex: number): string {
  return `m/44'/501'/${accountIndex}'/0'`;
}

/** Index 0 is the house wallet by convention. */
export const HOUSE_ACCOUNT_INDEX = 0;

let cachedSeed: Buffer | null = null;
function getSeed(): Buffer {
  if (cachedSeed) return cachedSeed;
  if (!MNEMONIC) {
    throw new Error(
      "SOLANA_MNEMONIC not set. Generate one (e.g. `npx bip39-cli generate`) " +
        "and add to .env.local before using deposit/withdraw.",
    );
  }
  if (!validateMnemonic(MNEMONIC)) {
    throw new Error("SOLANA_MNEMONIC is not a valid BIP39 mnemonic");
  }
  cachedSeed = mnemonicToSeedSync(MNEMONIC);
  return cachedSeed;
}

const keypairCache = new Map<number, Keypair>();

/**
 * Derive the keypair for a given account index. Memoized — each derivation
 * does HMAC-SHA512 + ed25519 keygen, fast but not free at scale.
 */
export function keypairForIndex(accountIndex: number): Keypair {
  const cached = keypairCache.get(accountIndex);
  if (cached) return cached;
  const seed = getSeed();
  const { key } = derivePath(pathFor(accountIndex), seed.toString("hex"));
  const kp = Keypair.fromSeed(key);
  keypairCache.set(accountIndex, kp);
  return kp;
}

export function houseKeypair(): Keypair {
  return keypairForIndex(HOUSE_ACCOUNT_INDEX);
}

export function houseAddress(): string {
  return houseKeypair().publicKey.toBase58();
}

export function userDepositKeypair(userIndex: number): Keypair {
  if (userIndex === HOUSE_ACCOUNT_INDEX) {
    throw new Error("user index collides with house wallet (0)");
  }
  return keypairForIndex(userIndex);
}

export function userDepositAddress(userIndex: number): string {
  return userDepositKeypair(userIndex).publicKey.toBase58();
}

let cachedConnection: Connection | null = null;
export function connection(): Connection {
  if (!cachedConnection) {
    cachedConnection = new Connection(RPC_URL, "confirmed");
  }
  return cachedConnection;
}

/** Best-effort address parse — returns null on bad input. */
export function tryParseSolanaAddress(input: string): PublicKey | null {
  try {
    const pk = new PublicKey(input.trim());
    // Some random 32-byte strings are accepted by PublicKey() — check the
    // result is on-curve to be sure it's a real wallet address. Off-curve
    // addresses are valid PDAs but cannot receive plain SOL transfers.
    if (!PublicKey.isOnCurve(pk.toBuffer())) return null;
    return pk;
  } catch {
    return null;
  }
}

/** USD value of N lamports at the current configured price. */
export function lamportsToUsd(lamports: number): number {
  return (lamports / LAMPORTS_PER_SOL) * SOL_USD_PRICE;
}

/** Lamports needed to send `usd` worth of SOL at the current price. */
export function usdToLamports(usd: number): number {
  return Math.round((usd / SOL_USD_PRICE) * LAMPORTS_PER_SOL);
}

export function lamportsToSolString(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(9);
}

export function getRpcUrl(): string {
  return RPC_URL;
}
export function getSolUsdPrice(): number {
  return SOL_USD_PRICE;
}
