import { NextResponse } from "next/server";
import { ensureValidSession } from "@/lib/spotify";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await ensureValidSession();
    if (!session) {
      return NextResponse.json({ authenticated: false });
    }
    return NextResponse.json({
      authenticated: true,
      displayName: session.displayName
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "session_error";
    // A failed refresh means the session is dead; report unauthenticated.
    return NextResponse.json({ authenticated: false, error: msg });
  }
}
