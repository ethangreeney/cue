import { NextRequest, NextResponse } from "next/server";
import { getAuthorizeUrl } from "@/lib/spotify";
import { setOAuthState } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // The OAuth state lives in a host-scoped cookie. Spotify only ever returns to
  // the single registered redirect URI (its host is APP_BASE_URL), so if login
  // starts on a different host — the classic localhost vs 127.0.0.1 dev mix-up —
  // the cookie set here never reaches /callback and the round-trip dies with
  // state_mismatch. Bounce to the canonical host first so it can't happen.
  const base = process.env.APP_BASE_URL;
  const host = req.headers.get("host");
  if (base && host) {
    const canonical = new URL(base);
    if (host !== canonical.host) {
      canonical.pathname = "/api/login";
      return NextResponse.redirect(canonical.toString());
    }
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  await setOAuthState(state);
  return NextResponse.redirect(getAuthorizeUrl(state));
}
