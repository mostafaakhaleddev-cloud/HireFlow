import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { config, isLoopback } from "./config";
import { assertStagingTarget } from "./test-target";

const globalDb = globalThis as unknown as { hireflowPool?: Pool };
export function pool() {
  const c = config();
  if (c.STAGING_SYNTHETIC_ONLY === "true") assertStagingTarget(c);
  if (
    !isLoopback(c.DATABASE_URL) &&
    new URL(c.DATABASE_URL).searchParams.get("sslmode") !== "verify-full"
  )
    throw new Error(
      "Hosted DATABASE_URL requires sslmode=verify-full; credentials redacted.",
    );
  if (!globalDb.hireflowPool)
    globalDb.hireflowPool = new Pool({
      connectionString: c.DATABASE_URL,
      max: 8,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 15000,
      application_name: "hireflow-web",
    });
  return globalDb.hireflowPool;
}
export async function transaction<T>(
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool().connect();
  try {
    await db.query("begin");
    await db.query("set local role hireflow_backend");
    await db.query("set local statement_timeout = '8s'");
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
) {
  return transaction((db) => db.query<T>(sql, values));
}
export async function lock(db: PoolClient, key: string) {
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
}
export async function audit(
  db: PoolClient,
  actor: string,
  action: string,
  objectId: string,
  requestId: string,
  details: Record<string, unknown> = {},
) {
  await db.query(
    "insert into audit_log(actor,action,object_id,request_id,details) values($1,$2,$3,$4,$5)",
    [actor, action, objectId, requestId, details],
  );
}
