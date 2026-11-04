import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { config as getConfig, configured } from "./lib/config";
export async function proxy(request: NextRequest) {
  if (!configured()) return NextResponse.next();
  const c = getConfig();
  let response = NextResponse.next({ request });
  const client = createServerClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach((i) => request.cookies.set(i.name, i.value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: "lax",
            secure: new URL(c.APP_URL).protocol === "https:",
          }),
        );
      },
    },
  });
  // Refreshes verified Auth cookies. Each sensitive page/API separately checks current membership.
  await client.auth.getUser();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: [
    "/jobs/:path*",
    "/candidates/:path*",
    "/applications/:path*",
    "/interviews/:path*",
    "/operations/:path*",
    "/reset-password",
  ],
};
