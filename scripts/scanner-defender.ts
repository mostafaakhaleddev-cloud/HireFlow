import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { digest, safeEqual } from "../src/lib/signing";
const exec = promisify(execFile),
  token = process.env.SCANNER_TOKEN;
if (process.platform !== "win32" || !token || token.length < 32)
  throw new Error("Windows and SCANNER_TOKEN required.");
const executable = join(
  process.env.ProgramFiles || "C:\\Program Files",
  "Windows Defender",
  "MpCmdRun.exe",
);
const root = resolve("test-results/scanner-quarantine");
await mkdir(root, { recursive: true });
let active = false;
createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST" || req.url !== "/scan") {
    res.writeHead(404).end("{}");
    return;
  }
  if (!safeEqual(req.headers.authorization || "", "Bearer " + token)) {
    res.writeHead(401).end("{}");
    return;
  }
  if (active) {
    res.writeHead(503).end("{}");
    return;
  }
  active = true;
  let directory: string | undefined;
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    req.setTimeout(10000, () => req.destroy());
    for await (const part of req) {
      size += part.length;
      if (size > 5242880) throw new Error("SIZE");
      chunks.push(part);
    }
    const bytes = Buffer.concat(chunks),
      sha256 = digest(bytes);
    if (!size || req.headers["x-content-sha256"] !== sha256) {
      res.writeHead(400).end("{}");
      return;
    }
    directory = await mkdtemp(join(root, "cv-"));
    const file = join(directory, "untrusted.bin");
    await writeFile(file, bytes, { flag: "wx" });
    // Never use shell interpolation or a caller-controlled path. No remediation,
    // exclusions or protection-setting changes. Nonzero/timeout fails closed.
    await exec(
      executable,
      ["-Scan", "-ScanType", "3", "-File", file, "-DisableRemediation"],
      { windowsHide: true, timeout: 15000, maxBuffer: 65536 },
    );
    if (digest(await readFile(file)) !== sha256)
      throw new Error("BYTES_CHANGED");
    res.end(
      JSON.stringify({ clean: true, sha256, engine: "Microsoft Defender" }),
    );
  } catch {
    res
      .writeHead(503)
      .end(JSON.stringify({ error: "SCAN_FAILED_OR_DETECTED" }));
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    active = false;
  }
}).listen(4002, "127.0.0.1", () =>
  console.log(
    "Authenticated Defender scan adapter on loopback port 4002. Failed or detected files never receive a clean verdict.",
  ),
);
