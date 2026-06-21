import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, getProfile } from "@/lib/spotify";
import { consumeOAuthState, setSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function base(): string {
  return process.env.APP_BASE_URL || "http://127.0.0.1:8888";
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${base()}/?error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${base()}/?error=missing_code`);
  }

  const expected = await consumeOAuthState();
  if (!expected || expected !== state) {
    return NextResponse.redirect(`${base()}/?error=state_mismatch`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const profile = await getProfile(tokens.access_token);
    await setSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      expiresAt: Date.now() + tokens.expires_in * 1000,
      userId: profile.id,
      displayName: profile.display_name || profile.id
    });
    return NextResponse.redirect(`${base()}/`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "auth_failed";
    return NextResponse.redirect(`${base()}/?error=${encodeURIComponent(msg.slice(0, 120))}`);
  }
}
