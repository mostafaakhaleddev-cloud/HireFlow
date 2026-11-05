import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { config } from "../src/lib/config";
import { pool,query } from "../src/lib/db";
import { syntheticPdf } from "../scripts/fixtures";
import { signRequest } from "../src/lib/signing";
import { assertSyntheticTestTarget } from "../src/lib/test-target";
const c = config();
assertSyntheticTestTarget(c);
const admin = createClient(c.SUPABASE_URL, c.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const users: Record<string, { id: string; cookie: string; token: string }> = {};
before(async () => {
  for (const role of ["nonmember", "disabled", "hr", "admin"]) {
    const email = `test-${role}-${randomUUID()}@example.test`,
      password = randomUUID() + "Aa!";
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert.equal(created.error, null);
    const id = created.data.user!.id;
    if (role !== "nonmember")
      await query(
        "insert into staff(id,display_name,role,active,calendar_id) values($1,$2,$3,$4,$5)",
        [
          id,
          "Synthetic " + role,
          role === "admin" ? "admin" : "hr",
          role !== "disabled",
          "synthetic-calendar@example.test",
        ],
      );
    const jar = new Map<string, string>(),
      client = createServerClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (items) => items.forEach((i) => jar.set(i.name, i.value)),
        },
      });
    const login = await client.auth.signInWithPassword({ email, password });
    assert.equal(login.error, null);
    users[role] = {
      id,
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
      token: login.data.session!.access_token,
    };
  }
});
after(async () => {
  for (const user of Object.values(users)) {
    await query("delete from staff where id=$1", [user.id]);
    await admin.auth.admin.deleteUser(user.id);
  }
  await pool().end();
});
async function api(path: string, role?: string, body?: unknown) {
  return fetch(c.APP_URL + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(role ? { Cookie: users[role].cookie } : {}),
      Origin: c.APP_URL,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
test("anonymous, nonmember and disabled identities cannot read private CV or mutate jobs", async () => {
  const fake = randomUUID();
  for (const [role, status] of [
    [undefined, 401],
    ["nonmember", 403],
    ["disabled", 403],
  ] as const) {
    assert.equal(
      (await api(`/api/applications/${fake}/cv`, role)).status,
      status,
    );
    assert.equal((await api("/api/jobs", role, {})).status, status);
  }
});
test("HR cannot promote themselves; admin operation remains restricted and rejects self changes", async () => {
  assert.equal(
    (
      await api("/api/staff", "hr", {
        id: users.hr.id,
        role: "admin",
        active: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("/api/staff", "admin", {
        id: users.admin.id,
        role: "hr",
        active: false,
      })
    ).status,
    403,
  );
  assert.equal((await api("/api/staff", "hr")).status, 403);
  assert.equal((await api("/api/staff", "admin")).status, 200);
});
test("Supabase REST and private Storage deny direct access to all browser identities", async () => {
  for (const role of [undefined, "nonmember", "disabled", "hr", "admin"]) {
    const headers = {
      apikey: c.SUPABASE_ANON_KEY,
      Authorization:
        "Bearer " + (role ? users[role].token : c.SUPABASE_ANON_KEY),
    };
    for (const table of [
      "staff",
      "applications",
      "uploads",
      "analysis_runs",
      "invitations",
    ]) {
      const result = await fetch(
        c.SUPABASE_URL + "/rest/v1/" + table + "?select=*",
        { headers },
      );
      assert.ok(
        [401, 403].includes(result.status),
        `${role || "anonymous"} ${table} must deny`,
      );
    }
    const storage = await fetch(
      c.SUPABASE_URL + "/storage/v1/object/list/candidate-cvs",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: '{"prefix":"","limit":10}',
      },
    );
    const data = await storage.json();
    assert.ok(
      !storage.ok || (Array.isArray(data) && data.length === 0),
      "Storage must not enumerate objects",
    );
  }
});
test("origin checks, unsigned workflow calls and workflow scope are rejected", async () => {
  assert.equal(
    (
      await fetch(c.APP_URL + "/api/jobs", {
        method: "POST",
        headers: {
          Cookie: users.hr.cookie,
          Origin: "https://evil.example",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(c.APP_URL + "/api/internal/intake/gmail", {
        method: "POST",
        body: "{}",
      })
    ).status,
    401,
  );
  const path = "/api/internal/intake/gmail",
    body = "{}";
  assert.equal(
    (
      await fetch(c.APP_URL + path, {
        method: "POST",
        headers: signRequest("wf03", c.WF03_KEY, "POST", path, body),
        body,
      })
    ).status,
    403,
  );
});
test('direct RPC cannot execute protected trigger functions for any browser identity',async()=>{
 for(const role of [undefined,'nonmember','disabled','hr','admin'])for(const fn of ['protect_job','protect_run','protect_application','protect_upload']){
  const response=await fetch(c.SUPABASE_URL+'/rest/v1/rpc/'+fn,{method:'POST',headers:{apikey:c.SUPABASE_ANON_KEY,Authorization:'Bearer '+(role?users[role].token:c.SUPABASE_ANON_KEY),'Content-Type':'application/json'},body:'{}'});
  assert.ok([401,403,404].includes(response.status),'RPC must be denied or absent from exposed schema');
  assert.equal((await query("select has_function_privilege('anon',$1,'EXECUTE') as anon,has_function_privilege('authenticated',$1,'EXECUTE') as authenticated",['public.'+fn+'()'])).rows[0].anon,false);
  assert.equal((await query("select has_function_privilege('authenticated',$1,'EXECUTE') as allowed",['public.'+fn+'()'])).rows[0].allowed,false);
 }
});
test("unsupported, oversize and mislabeled uploads fail before a reusable handle is created", async () => {
  const uploads = [
    {
      name: "bad.exe",
      type: "application/pdf",
      bytes: syntheticPdf(),
      status: 415,
    },
    { name: "bad.pdf", type: "text/plain", bytes: syntheticPdf(), status: 415 },
    {
      name: "large.pdf",
      type: "application/pdf",
      bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
      status: 413,
    },
  ];
  for (const u of uploads) {
    const response = await fetch(
      c.APP_URL + "/api/uploads?job_code=JOB-BE-001",
      {
        method: "POST",
        headers: {
          Origin: c.APP_URL,
          "Content-Type": u.type,
          "X-File-Name": u.name,
        },
        body: new Uint8Array(u.bytes),
      },
    );
    assert.equal(response.status, u.status);
  }
});
