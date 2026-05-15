import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import {
  DEMO_CURRENCY,
  createUserAccount,
  seedDemoBalance,
} from "@/lib/db/ledger";
import { generateDisplayName } from "@/lib/displayNames";

const REFERRAL_CODE_LEN = 8;

export interface BootstrapInput {
  email: string;
  /** Pre-hashed password (bcrypt). Null for OAuth/wallet-only users. */
  passwordHash?: string | null;
  /** Google's name, email prefix, or wallet shortcode. */
  displayName?: string | null;
  /** Solana base58 address — only for wallet sign-up. */
  solanaAddress?: string | null;
  /** Inviter's referral code, if any. Unknown codes are ignored silently. */
  referralCode?: string | null;
}

/**
 * Single source of truth for "make a new user". Used by every signup flow:
 * email/password registration, Google OAuth first-login, wallet first-login.
 *
 * Side effects:
 *   1. Insert users row (with referral code, display name, optional wallet).
 *   2. Resolve the inviter's userId from `referralCode` and store as `referred_by_id`.
 *   3. Create the user's `user`-type wallet account in the ledger.
 *   4. Post the demo welcome bonus from house.
 */
export async function bootstrapNewUser(input: BootstrapInput): Promise<User> {
  const email = input.email.toLowerCase().trim();

  let referredById: string | null = null;
  if (input.referralCode) {
    const code = input.referralCode.toUpperCase().trim();
    const [referrer] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.referralCode, code))
      .limit(1);
    if (referrer) referredById = referrer.id;
  }

  const referralCode = generateReferralCode();
  const displayName =
    (input.displayName ?? "").trim() || email.split("@")[0];

  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash: input.passwordHash ?? null,
      solanaAddress: input.solanaAddress ?? null,
      displayName,
      referralCode,
      referredById,
    })
    .returning();

  const wallet = await createUserAccount(user.id, DEMO_CURRENCY);
  await seedDemoBalance(wallet.id);
  return user;
}

/**
 * Find or create a user by email. Returns the existing row if the email is
 * already registered. Used by Google OAuth: the first time a Google email
 * shows up, we bootstrap a new account; thereafter we reuse it.
 */
export async function getOrCreateUserByEmail(input: BootstrapInput): Promise<User> {
  const email = input.email.toLowerCase().trim();
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) return existing;
  return bootstrapNewUser(input);
}

/**
 * Find or create a user by Solana address. Generates a synthetic email of
 * the form `<address>@wallet.local` so the unique-email constraint is
 * satisfied even when no email is provided. The user can later attach an
 * email via the settings page (not implemented yet).
 */
export async function getOrCreateUserByWallet(
  solanaAddress: string,
): Promise<User> {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.solanaAddress, solanaAddress))
    .limit(1);
  if (existing) return existing;

  const syntheticEmail = `${solanaAddress.toLowerCase()}@wallet.local`;
  return bootstrapNewUser({
    email: syntheticEmail,
    solanaAddress,
    // Random friendly name. The full address is still stored on the row
    // so user can see / change later via settings.
    displayName: generateDisplayName(),
  });
}

function generateReferralCode(): string {
  return randomBytes(REFERRAL_CODE_LEN / 2)
    .toString("hex")
    .toUpperCase();
}
