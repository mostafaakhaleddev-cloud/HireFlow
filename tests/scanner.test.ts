import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { scanFile } from "../src/lib/scanner";
import { digest } from "../src/lib/signing";
test("scanner HTTP adapter fails closed on negative, wrong hash, invalid JSON, redirect, oversized response, outage and timeout", async () => {
  const bytes = Buffer.from("synthetic scan contract"),
    token = "t".repeat(48);
  let mode = "clean";
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer " + token);
    const chunks = [];
    for await (const b of req) chunks.push(b);
    assert.deepEqual(Buffer.concat(chunks), bytes);
    if (mode === "timeout") return;
    if (mode === "redirect") {
      res.writeHead(302, { Location: "http://127.0.0.1:1/" }).end();
      return;
    }
    if (mode === "down") {
      res.writeHead(503).end();
      return;
    }
    res.end(
      mode === "invalid"
        ? "not-json"
        : mode === "large"
          ? "x".repeat(4097)
          : JSON.stringify({
              clean: mode !== "detected",
              sha256: mode === "hash" ? "wrong" : digest(bytes),
            }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await scanFile(bytes, url, token);
    for (mode of [
      "detected",
      "hash",
      "invalid",
      "redirect",
      "large",
      "down",
      "timeout",
    ])
      await assert.rejects(
        () => scanFile(bytes, url, token, mode === "timeout" ? 50 : 2000),
        (e) =>
          (e as { status: number }).status ===
          (mode === "detected" ? 415 : 503),
      );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
