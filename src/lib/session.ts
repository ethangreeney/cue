import { cookies } from "next/headers";

// The session payload stored (httpOnly) in a single cookie.
export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  userId: string;
  displayName: string;
}

const COOKIE = "needle_session";
const STATE_COOKIE = "needle_oauth_state";

function encode(s: Session): string {
  return Buffer.from(JSON.stringify(s), "utf8").toString("base64url");
}

function decode(raw: string): Session | null {
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Session;
  } catch {
    return null;
  }
}

// Secure cookies whenever we're served over HTTPS (production); plain http on
// the 127.0.0.1 loopback during local dev can't use the Secure attribute.
function secureCookies(): boolean {
  return (process.env.APP_BASE_URL || "").startsWith("https");
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  return decode(raw);
}

export async function setSession(s: Session): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, encode(s), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function setOAuthState(state: string): Promise<void> {
  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: 60 * 10
  });
}

export async function consumeOAuthState(): Promise<string | null> {
  const store = await cookies();
  const v = store.get(STATE_COOKIE)?.value ?? null;
  if (v) store.delete(STATE_COOKIE);
  return v;
}
