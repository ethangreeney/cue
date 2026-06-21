import { NextResponse } from "next/server";
import { getAuthorizeUrl } from "@/lib/spotify";
import { setOAuthState } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  await setOAuthState(state);
  return NextResponse.redirect(getAuthorizeUrl(state));
}
