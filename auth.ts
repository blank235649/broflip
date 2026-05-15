import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { RateLimiter, getClientIp } from "@/lib/rateLimit";
import {
  buildSignInMessage,
  consumeNonce,
  verifySignature,
} from "@/lib/solanaSignIn";
import {
  getOrCreateUserByEmail,
  getOrCreateUserByWallet,
} from "@/lib/userBootstrap";

// Two-axis login limit: by IP (raw flooding) and by email (credential
// stuffing on a known account). Either tripping rejects the attempt with
// the same generic null result, so attackers can't tell what's blocking.
const loginIpLimiter = new RateLimiter(5 * 60 * 1000, 10);
const loginEmailLimiter = new RateLimiter(15 * 60 * 1000, 5);

// Solana wallet attempts — separate axis from email login.
const walletIpLimiter = new RateLimiter(5 * 60 * 1000, 10);

const providers: NextAuthConfig["providers"] = [
  Credentials({
    id: "credentials",
    credentials: { email: {}, password: {} },
    authorize: async (credentials, request) => {
      const email = (credentials?.email as string | undefined)?.toLowerCase().trim();
      const password = credentials?.password as string | undefined;
      if (!email || !password) return null;

      const ip = getClientIp(request as Request);
      if (!loginIpLimiter.check(ip).allowed) return null;
      if (!loginEmailLimiter.check(email).allowed) return null;

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (!user || !user.passwordHash) return null;

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return null;

      return { id: user.id, email: user.email };
    },
  }),
  // Solana wallet: client signs the canonical message with the nonce we
  // issued earlier; server verifies signature + consumes nonce.
  Credentials({
    id: "solana",
    credentials: {
      address: {},
      signature: {}, // base58
      nonce: {},
    },
    authorize: async (credentials, request) => {
      const address = credentials?.address as string | undefined;
      const signature = credentials?.signature as string | undefined;
      const nonce = credentials?.nonce as string | undefined;
      if (!address || !signature || !nonce) return null;

      const ip = getClientIp(request as Request);
      if (!walletIpLimiter.check(ip).allowed) return null;

      // Single-use: consumeNonce returns false on dup or expired.
      if (!consumeNonce(nonce)) return null;
      const message = buildSignInMessage(address, nonce);
      if (!verifySignature({ address, signatureBase58: signature, message })) {
        return null;
      }

      const user = await getOrCreateUserByWallet(address);
      return { id: user.id, email: user.email };
    },
  }),
];

// Google OAuth is optional — only register the provider if creds are set,
// otherwise the rest of the app still boots locally without secrets.
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Trust Google's verified-email response — no need for our own
      // verification flow on top.
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  providers,
  pages: {
    signIn: "/",
  },
  callbacks: {
    // Runs after a provider authenticates the user. Credentials providers
    // already returned a user with our `id` set; OAuth providers (Google)
    // give us their profile and we have to map to / create our user row.
    signIn: async ({ user, account }) => {
      if (account?.provider === "google" && user.email) {
        const dbUser = await getOrCreateUserByEmail({
          email: user.email,
          displayName: user.name ?? null,
        });
        // Mutate the Auth.js user object so `id` flows into our JWT below.
        user.id = dbUser.id;
        return true;
      }
      return true;
    },
    jwt: ({ token, user }) => {
      if (user?.id) token.id = user.id;
      return token;
    },
    session: ({ session, token }) => {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
