import { AppError } from "./errors";
import { digest } from "./signing";

// The bytes stay in bounded server memory until this gate returns. No Storage
// object, upload capability or analysis intent exists on any failure path.
export async function scanFile(
  bytes: Buffer,
  url: string,
  token: string,
  timeoutMs = 20000,
) {
  const sha256 = digest(bytes);
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Content-SHA256": sha256,
        Authorization: "Bearer " + token,
      },
      body: new Uint8Array(bytes),
    });
    if (!response.ok || !response.body) throw new Error("SCANNER_UNAVAILABLE");
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) {
        await reader.cancel();
        throw new Error("SCANNER_RESPONSE");
      }
      parts.push(value);
    }
    const verdict = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (verdict.sha256 !== sha256 || typeof verdict.clean !== "boolean")
      throw new Error("SCANNER_RESPONSE");
    if (!verdict.clean)
      throw new AppError(
        "SCAN_REJECTED",
        "The CV did not pass file scanning.",
        415,
      );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "SCANNER_UNAVAILABLE",
      "File scanning is temporarily unavailable. Please retry.",
      503,
      true,
    );
  }
}
