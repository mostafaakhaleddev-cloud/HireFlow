import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { config } from "./config";
import { query } from "./db";
import { digest, verifyRequest } from "./signing";
export function json(body: unknown, status = 200, requestId?: string) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Request-Id": requestId || randomUUID(),
    },
  });
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(config().APP_URL).origin)
    throw new AppError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
}
export async function boundedBody(request: Request, max = 128 * 1024) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > max))
    throw new AppError("TOO_LARGE", "Request exceeds the size limit.", 413);
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError("TOO_LARGE", "Request exceeds the size limit.", 413);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
export async function bodyJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("MEDIA_TYPE", "Expected JSON.", 415);
  try {
    return JSON.parse((await boundedBody(request)).toString("utf8"));
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("INVALID_JSON", "Invalid JSON request.", 400);
  }
}
export async function rateLimit(
  request: Request,
  bucket: string,
  max: number,
  seconds = 60,
  identity?: string,
) {
  const ip =
    config().TRUST_PROXY === "true"
      ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown"
      : "local-or-untrusted-proxy";
  const key = digest(bucket + ":" + (identity || ip));
  const { rows } = await query<{ count: number }>(
    `insert into rate_limits(key,window_start,count) values($1,now(),1)
    on conflict(key) do update set count=case when rate_limits.window_start<now()-make_interval(secs=>$2) then 1 else rate_limits.count+1 end,
    window_start=case when rate_limits.window_start<now()-make_interval(secs=>$2) then now() else rate_limits.window_start end returning count`,
    [key, seconds],
  );
  if (rows[0].count > max)
    throw new AppError(
      "RATE_LIMIT",
      "Too many requests. Please try again shortly.",
      429,
      true,
    );
}
export async function internalAuth(request: Request, scopes: string[]) {
  await rateLimit(request, "internal-attempts", 300);
  const raw = (await boundedBody(request)).toString("utf8"),
    c = config();
  const workflow = verifyRequest(
    request.headers,
    request.method,
    request.url,
    raw,
    { wf01: c.WF01_KEY, wf02: c.WF02_KEY, wf03: c.WF03_KEY, wf04: c.WF04_KEY },
    scopes,
  );
  await rateLimit(request, "internal", 240, 60, workflow);
  let body: unknown = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new AppError("INVALID_JSON", "Invalid JSON request.", 400);
    }
  }
  return { workflow, body };
}
export async function endpoint(
  fn: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const id = randomUUID(),
    start = Date.now();
  try {
    return await fn(id);
  } catch (error) {
    if (error instanceof AppError) {
      if (
        error.code === "INVALID_SIGNATURE" ||
        error.code === "WORKFLOW_SCOPE" ||
        error.code === "STALE_RUN" ||
        error.code === "STALE_REVISION"
      )
        console.warn(
          JSON.stringify({ level: "warn", request_id: id, code: error.code }),
        );
      const response = json(
        {
          error: {
            code: error.code,
            message: error.message,
            request_id: id,
            retryable: error.retryable,
          },
        },
        error.status,
        id,
      );
      if (error.status === 429) response.headers.set("Retry-After", "60");
      return response;
    }
    if (error instanceof ZodError)
      return json(
        {
          error: {
            code: "VALIDATION",
            message: "Please check the supplied fields.",
            fields: error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
            request_id: id,
            retryable: false,
          },
        },
        400,
        id,
      );
    const code = (error as { code?: string }).code;
    if (
      code === "23505" ||
      code === "23P01" ||
      code === "40001" ||
      code === "40P01"
    )
      return json(
        {
          error: {
            code: "CONFLICT",
            message:
              "This action conflicts with a current record. Refresh and try again.",
            request_id: id,
            retryable: true,
          },
        },
        409,
        id,
      );
    // Never log request URLs, body, tokens, SQL values, or provider messages.
    console.error(
      JSON.stringify({
        level: "error",
        request_id: id,
        code: code || "SERVER_ERROR",
        elapsed_ms: Date.now() - start,
      }),
    );
    return json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "The service is unavailable. Please try again.",
          request_id: id,
          retryable: true,
        },
      },
      503,
      id,
    );
  }
}
