import { dispatchBatch } from "../src/lib/dispatcher";
import { pool } from "../src/lib/db";
import { config } from "../src/lib/config";
config();
let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});
console.log(
  "HireFlow dispatcher: bounded batches of 4, 60s leases, 8 attempts. Logs contain counts only.",
);
do {
  try {
    const count = await dispatchBatch();
    if (count) console.log(JSON.stringify({ action: "dispatch_batch", count }));
  } catch {
    console.error(JSON.stringify({ code: "DISPATCHER_DATABASE_UNAVAILABLE" }));
  }
  if (process.argv.includes("--once")) break;
  await new Promise((r) => setTimeout(r, 2000));
} while (running);
await pool().end();
