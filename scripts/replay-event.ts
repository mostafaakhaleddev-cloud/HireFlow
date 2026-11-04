import { z } from "zod";
import { randomUUID } from "node:crypto";
import { config, isLoopback } from "../src/lib/config";
import { audit, pool, transaction } from "../src/lib/db";
const c = config();
if (!isLoopback(c.APP_URL))
  throw new Error("Use a reviewed operator connection for hosted replay.");
const id = z.uuid().parse(process.argv[2]);
await transaction(async (db) => {
  const event = (
    await db.query(
      "select * from integration_events where id=$1 and state='exhausted' for update",
      [id],
    )
  ).rows[0];
  if (!event) throw new Error("Only exhausted events may be replayed here.");
  await db.query(
    "update integration_events set state='pending',attempts=0,available_at=now(),lease_id=null,lease_until=null,safe_error=null where id=$1",
    [id],
  );
  await audit(db, "local-operator", "outbox.replayed", id, randomUUID());
});
console.log(
  "Original event requeued; business-level deduplication remains active.",
);
await pool().end();
