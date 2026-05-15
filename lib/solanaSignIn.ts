import { randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

/**
 * Sign-In-With-Solana (SIWS-ish) helpers.
 *
 *   1. Client requests a nonce → issueNonce()
 *   2. Client signs `buildSignInMessage(address, nonce)` with their wallet
 *   3. Client posts (address, signature, nonce) back
 *   4. Server consumeNonce() — succeeds at most once, expires after TTL
 *   5. Server verifySignature() against the now-public message
 *
 * Nonces live in-process. Multi-instance deployment needs Redis with the
 * same one-shot semantics (e.g. SET NX with EXPIRE).
 */

const NONCE_TTL_MS = 5 * 60 * 1000;
const issuedNonces = new Map<string, number>(); // nonce → expiresAt

// GC every minute. Bounded — entries auto-expire and the map can't grow
// past ~5 min of issuance × however many requests/sec come in.
setInterval(() => {
  const now = Date.now();
  for (const [nonce, expiresAt] of issuedNonces) {
    if (expiresAt <= now) issuedNonces.delete(nonce);
  }
}, 60_000).unref?.();

export function issueNonce(): string {
  const nonce = randomBytes(16).toString("hex");
  issuedNonces.set(nonce, Date.now() + NONCE_TTL_MS);
  return nonce;
}

/** Returns true if the nonce was valid and unused. Single-use semantics. */
export function consumeNonce(nonce: string): boolean {
  const expiresAt = issuedNonces.get(nonce);
  if (!expiresAt) return false;
  issuedNonces.delete(nonce);
  return expiresAt > Date.now();
}

/**
 * The exact text the wallet is asked to sign. Includes the domain so a
 * signature for one site can't be replayed against another, and the nonce
 * so a captured signature can't be replayed against this site twice.
 */
export function buildSignInMessage(address: string, nonce: string): string {
  return `Broflip wants you to sign in with your Solana account:
${address}

Sign this message to prove ownership. This will not trigger a transaction
or cost any gas.

Nonce: ${nonce}`;
}

export function verifySignature(args: {
  address: string;
  signatureBase58: string;
  message: string;
}): boolean {
  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(args.address);
  } catch {
    return false;
  }
  const messageBytes = new TextEncoder().encode(args.message);
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = bs58.decode(args.signatureBase58);
  } catch {
    return false;
  }
  return nacl.sign.detached.verify(
    messageBytes,
    signatureBytes,
    pubkey.toBytes(),
  );
}
