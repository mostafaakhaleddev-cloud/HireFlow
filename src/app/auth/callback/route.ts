import { NextResponse } from "next/server";
import { authClient } from "@/lib/auth";
import { config } from "@/lib/config";
export async function GET(request: Request) {
  const url = new URL(request.url),
    code = url.searchParams.get("code");
  const client = await authClient();
  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(
          url.searchParams.get("next") === "/reset-password"
            ? "/reset-password"
            : "/jobs",
          config().APP_URL,
        ),
      );
  }
  const tokenHash = url.searchParams.get("token_hash"),
    type = url.searchParams.get("type");
  if (tokenHash && type === "recovery") {
    const { error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    if (!error)
      return NextResponse.redirect(
        new URL("/reset-password", config().APP_URL),
      );
  }
  return NextResponse.redirect(
    new URL("/login?error=invalid_recovery_link", config().APP_URL),
  );
}
