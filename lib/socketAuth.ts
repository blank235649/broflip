import { SignJWT, jwtVerify } from "jose";

export const SOCKET_TICKET_TTL = "60s";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export interface SocketTicket {
  userId: string;
  email: string;
}

export async function signSocketTicket(payload: SocketTicket): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SOCKET_TICKET_TTL)
    .setAudience("broflip-socket")
    .sign(getSecret());
}

export async function verifySocketTicket(token: string): Promise<SocketTicket> {
  const { payload } = await jwtVerify(token, getSecret(), {
    audience: "broflip-socket",
  });
  if (typeof payload.userId !== "string" || typeof payload.email !== "string") {
    throw new Error("malformed socket ticket");
  }
  return { userId: payload.userId, email: payload.email };
}
