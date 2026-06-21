import { NextResponse } from "next/server";
import { ensureValidSession, getProfile } from "@/lib/spotify";

export const dynamic = "force-dynamic";

// Hands the logged-in user's short-lived Spotify access token to the browser so
// the Web Playback SDK can stream in-page. The SDK requires the token client-
// side — there is no server-proxy alternative for playback. We also report
// whether the account is Premium, since the SDK only works for Premium users.
export async function GET() {
  try {
    const session = await ensureValidSession();
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    // Premium status decides whether we even attempt the in-page player.
    let isPremium = false;
    try {
      const profile = await getProfile(session.accessToken);
      isPremium = profile.product === "premium";
    } catch {
      // If the profile call fails we still hand back the token; the SDK's own
      // account_error will trigger the link-out fallback.
    }
    return NextResponse.json({
      authenticated: true,
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      isPremium
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "session_error";
    return NextResponse.json({ authenticated: false, error: msg }, { status: 401 });
  }
}
