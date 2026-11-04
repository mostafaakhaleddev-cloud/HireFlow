import { createServer, type IncomingMessage } from "node:http";
import { config, isLoopback } from "../src/lib/config";
import { eventSchema, type IntegrationEvent } from "../src/lib/contracts";
import { safeEqual } from "../src/lib/signing";
import { internal } from "./client";
import { syntheticAnalysis } from "./fixtures";
import { webhookPath } from '../src/lib/dispatcher';
const c = config();
if (c.INTEGRATION_MODE !== "simulator" || !isLoopback(c.APP_URL))
  throw new Error("The synthetic simulator is strictly local-only.");
let mode = "normal";
const modes = [
  "normal",
  "duplicate",
  "stale",
  "timeout",
  "unreadable",
  "analysis-failure",
  "uncertain-send",
  "send-failure",
  "calendar-failure",
  "calendar-unknown",
];
async function read(req: IncomingMessage) {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const part of req) {
    size += part.length;
    if (size > 128 * 1024) throw new Error("TOO_LARGE");
    parts.push(part);
  }
  return Buffer.concat(parts).toString();
}
async function execute(event: IntegrationEvent) {
  if (event.event_type==='application.created'||event.event_type==='application.analysis_requested') {
    const context = await internal(
      `/api/internal/applications/${event.application_id}/analysis-context?run_id=${event.analysis_run_id}`,
      "wf01",
    );
    if (
      [
        "completed",
        "needs_manual_review",
        "failed_final",
        "failed_retryable",
      ].includes(context.status)
    )
      return;
    // Exercise the actual private file capability, but do not extract or send data externally.
    const cv = await fetch(context.cv.url, {
      signal: AbortSignal.timeout(10000),
    });
    if (!cv.ok) throw new Error("CV_UNAVAILABLE");
    await cv.arrayBuffer();
    const result = {
      schema_version: 1,
      event_id: event.event_id,
      application_id: event.application_id,
      analysis_run_id: event.analysis_run_id,
      requirements_version: context.job_snapshot.requirements_version,
      outcome:
        mode === "unreadable"
          ? "needs_manual_review"
          : mode === "analysis-failure"
            ? "failed_retryable"
            : "completed",
      ...(mode === "unreadable"
        ? { error_code: "UNREADABLE_CV" }
        : mode === "analysis-failure"
          ? { error_code: "PROVIDER_TIMEOUT" }
          : { analysis: syntheticAnalysis(context.job_snapshot) }),
    };
    if (mode === "stale") {
      try {
        await internal(
          `/api/internal/applications/${event.application_id}/analysis-result`,
          "wf01",
          {
            ...result,
            requirements_version: context.job_snapshot.requirements_version + 1,
          },
        );
        throw new Error("STALE_RESULT_ACCEPTED");
      } catch (e) {
        if ((e as { status?: number }).status !== 409) throw e;
      }
    }
    await internal(
      `/api/internal/applications/${event.application_id}/analysis-result`,
      "wf01",
      result,
    );
    if (mode === "duplicate")
      await internal(
        `/api/internal/applications/${event.application_id}/analysis-result`,
        "wf01",
        result,
      );
  } else if (event.event_type === "interview.invitation_requested") {
    const claim = await internal(
      `/api/internal/notifications/${event.notification_id}/claim`,
      "wf02",
      { schema_version: 1 },
    );
    if (claim.status !== "claimed") return;
    const result = {
      schema_version: 1,
      claim_id: claim.claim_id,
      outcome:
        mode === "uncertain-send"
          ? "unknown"
          : mode === "send-failure"
            ? "failed"
            : "sent",
      ...(mode === "uncertain-send"
        ? { error_code: "TIMEOUT_UNCERTAIN" }
        : mode === "send-failure"
          ? { error_code: "PROVIDER_ERROR" }
          : { provider_id: "synthetic-" + event.notification_id }),
    };
    await internal(
      `/api/internal/notifications/${event.notification_id}/result`,
      "wf02",
      result,
    );
    // Never log booking links or recipients. Staff can use the explicit synthetic demo link.
  } else if (event.event_type === "interview.sync_requested") {
    const context = await internal(
      `/api/internal/interviews/${event.interview_id}/sync-context?event_id=${event.event_id}&revision=${event.revision}`,
      "wf03",
    );
    const result = {
      schema_version: 1,
      event_id: event.event_id,
      revision: event.revision,
      operation: context.operation,
      provider_event_id: context.provider_event_id,
      calendar_id: context.calendar_id,
      outcome:
        mode === "calendar-failure"
          ? "failed"
          : mode === "calendar-unknown"
            ? "unknown"
            : context.operation === "cancel"
              ? "cancelled"
              : "confirmed",
      ...(mode === "calendar-failure"
        ? { error_code: "CALENDAR_CONFLICT" }
        : mode === "calendar-unknown"
          ? { error_code: "TIMEOUT_UNCERTAIN" }
          : context.operation === "cancel"
            ? {}
            : { meet_url: "https://meet.google.com/abc-defg-hij" }),
    };
    await internal(
      `/api/internal/interviews/${event.interview_id}/sync-result`,
      "wf03",
      result,
    );
    if (mode === "duplicate")
      await internal(
        `/api/internal/interviews/${event.interview_id}/sync-result`,
        "wf03",
        result,
      );
  }
}
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (
    !safeEqual(
      req.headers["x-hireflow-secret"]?.toString() || "",
      c.WEB_TO_N8N_SECRET,
    )
  ) {
    res.writeHead(401);
    res.end('{"error":"unauthorized"}');
    return;
  }
  try {
    const raw = await read(req);
    if (req.url === "/__mode" && req.method === "POST") {
      const p = JSON.parse(raw);
      if (!modes.includes(p.mode)) throw new Error("MODE");
      mode = p.mode;
      res.end(JSON.stringify({ mode }));
      return;
    }
    if (req.url === "/__reminders" && req.method === "POST") {
      const due = await internal("/api/internal/reminders/claim", "wf04", {
        schema_version: 1,
      });
      for (const id of due.notification_ids) {
        const n = await internal(
          `/api/internal/notifications/${id}/claim`,
          "wf04",
          { schema_version: 1 },
        );
        if (n.status === "claimed")
          await internal(`/api/internal/notifications/${id}/result`, "wf04", {
            schema_version: 1,
            claim_id: n.claim_id,
            outcome: "sent",
            provider_id: "synthetic-" + id,
          });
      }
      res.end('{"status":"synthetic_reminders_processed"}');
      return;
    }
    if (
      req.method !== "POST" ||
      ![
        "/webhook/hireflow/application-created",
        "/webhook/hireflow/invitation-requested",
        "/webhook/hireflow/interview-sync",
      ].includes(req.url || "")
    ) {
      res.writeHead(404);
      res.end("{}");
      return;
    }
    const event = eventSchema.parse(JSON.parse(raw));
    if(req.url!==webhookPath(event.event_type))throw new Error('EVENT_ROUTE_MISMATCH');
    if (mode === "timeout") {
      setTimeout(() => {
        res.writeHead(504);
        res.end('{"status":"simulated_timeout"}');
      }, 12000);
      return;
    }
    // Complete before acknowledging: a failed callback causes the durable dispatcher to retry.
    await execute(event);
    res.end('{"status":"accepted","synthetic":true}');
  } catch (e) {
    console.error(
      JSON.stringify({
        code: "SIMULATOR_CYCLE_FAILED",
        status: (e as { status?: number }).status || 500,
      }),
    );
    res.writeHead(503);
    res.end('{"error":"synthetic_cycle_failed"}');
  }
});
server.listen(4001, "127.0.0.1", () =>
  console.log(
    "Synthetic n8n simulator listening on http://127.0.0.1:4001. No external email or Calendar calls.",
  ),
);
