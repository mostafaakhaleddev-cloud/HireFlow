import { z } from "zod";
import {
  endpoint,
  json,
  bodyJson,
  checkOrigin,
  rateLimit,
  internalAuth,
  boundedBody,
} from "@/lib/http";
import { config, configured } from "@/lib/config";
import {
  authClient,
  requireStaff,
  storageClient,
  staffTransaction,
} from "@/lib/auth";
import { query, audit } from "@/lib/db";
import {
  applicationAction,
  analysisContext,
  analysisResult,
  gmailIntake,
  jobsList,
  publicJob,
  saveJob,
  submitApplication,
} from "@/lib/domain";
import {
  book,
  bookingSlots,
  changeInterview,
  claimNotification,
  decide,
  dueReminders,
  invite,
  notificationResult,
  publishSlot,
  recoverNotification,
  syncContext,
  syncResult,
} from "@/lib/scheduling";
import { saveUpload, signedCv,uploadFileName } from "@/lib/uploads";
import { verifyRequest } from "@/lib/signing";
import { AppError, invariant } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ segments: string[] }> };
async function handler(request: Request, context: Context) {
  return endpoint(async (requestId) => {
    const { segments: s } = await context.params,
      path = s.join("/"),
      method = request.method,
      url = new URL(request.url);
    if (path === "health" && method === "GET")
      return json(
        {
          service: "hireflow",
          configuration: configured() ? "configured" : "setup_required",
        },
        200,
        requestId,
      );
    if (path === "ready" && method === "GET") {
      if (!configured())
        return json({ ready: false, reason: "setup_required" }, 503);
      try {
        await query("select 1");
        return json(
          {
            ready: true,
            build_mode:process.env.NODE_ENV,
            mode: config().INTEGRATION_MODE,
            scanner: config().SCANNER_URL
              ? "configured_not_verified"
              : "unconfigured",
          },
          200,
        );
      } catch {
        return json({ ready: false, reason: "database_unavailable" }, 503);
      }
    }
    if (!configured())
      throw new AppError(
        "SETUP_REQUIRED",
        "Local services are not configured. See README and docs/STATUS.md.",
        503,
      );
    // Validate identifiers before DB access; no malformed UUID should become a 5xx.
    if (
      ["jobs", "applications", "interviews", "notifications"].includes(s[0]) &&
      s[1] &&
      !["book"].includes(s[1])
    )
      z.uuid().parse(s[1]);
    if (
      s[0] === "internal" &&
      ["applications", "interviews", "notifications"].includes(s[1]) &&
      s[2]
    )
      z.uuid().parse(s[2]);
    if (path === "internal/attachments" && method === "POST") {
      await rateLimit(request, "internal-attachment-attempts", 40);
      const bytes = await boundedBody(request, config().UPLOAD_MAX_BYTES),
        c = config();
      verifyRequest(
        request.headers,
        method,
        request.url,
        bytes,
        { wf01: c.WF01_KEY },
        ["wf01"],
      );
      await rateLimit(request, "gmail-attachments", 30, 60, "wf01");
      const name = uploadFileName(request);
      return json(
        await saveUpload(
          bytes,
          name,
          request.headers.get("content-type") || "",
          "gmail",
        ),
        201,
        requestId,
      );
    }
    if (s[0] === "internal") {
      const scope =
        s[1] === "applications" || s[1] === "intake"
          ? ["wf01"]
          : s[1] === "interviews"
            ? ["wf03"]
            : s[1] === "reminders"
              ? ["wf04"]
              : ["wf02", "wf04"];
      const { body, workflow } = await internalAuth(request, scope);
      if (path === "internal/intake/gmail" && method === "POST")
        return json(await gmailIntake(body, requestId), 200, requestId);
      if (
        s[1] === "applications" &&
        s[3] === "analysis-context" &&
        method === "GET"
      ) {
        const run = await analysisContext(
          s[2],
          z.uuid().parse(url.searchParams.get("run_id")),
        );
        return json(
          {
            schema_version: 1,
            application_id: s[2],
            analysis_run_id: run.id,
            event_id: run.event_id,
            job_snapshot: run.job_snapshot,
            cv: {
              url: await signedCv(run.cv_upload_id),
              expires_in_seconds: 300,
            },
            status: run.status,
          },
          200,
          requestId,
        );
      }
      if (
        s[1] === "applications" &&
        s[3] === "analysis-result" &&
        method === "POST"
      )
        return json(
          await analysisResult(s[2], body, requestId),
          200,
          requestId,
        );
      if (s[1] === "notifications" && s[3] === "claim" && method === "POST") {
        z.object({ schema_version: z.literal(1) })
          .strict()
          .parse(body);
        return json(
          await claimNotification(s[2], workflow, requestId),
          200,
          requestId,
        );
      }
      if (s[1] === "notifications" && s[3] === "result" && method === "POST")
        return json(
          await notificationResult(s[2], body, workflow, requestId),
          200,
          requestId,
        );
      if (s[1] === "interviews" && s[3] === "sync-context" && method === "GET")
        return json(
          await syncContext(
            s[2],
            z.coerce
              .number()
              .int()
              .positive()
              .parse(url.searchParams.get("revision")),
            z.uuid().parse(url.searchParams.get("event_id")),
          ),
          200,
          requestId,
        );
      if (s[1] === "interviews" && s[3] === "sync-result" && method === "POST")
        return json(await syncResult(s[2], body, requestId), 200, requestId);
      if (path === "internal/reminders/claim" && method === "POST") {
        z.object({ schema_version: z.literal(1) })
          .strict()
          .parse(body);
        return json(await dueReminders(requestId), 200, requestId);
      }
      throw new AppError("NOT_FOUND", "Endpoint not found.", 404);
    }
    if (method !== "GET") checkOrigin(request);
    if (path === "auth/login" && method === "POST") {
      await rateLimit(request, "login", 10, 600);
      const p = z
        .object({
          email: z.email().max(254),
          password: z.string().min(8).max(200),
        })
        .strict()
        .parse(await bodyJson(request));
      const client = await authClient(),
        { error } = await client.auth.signInWithPassword(p);
      if (error)
        throw new AppError(
          "LOGIN_FAILED",
          "Unable to sign in with these credentials.",
          401,
        );
      try {
        await requireStaff();
      } catch (e) {
        await client.auth.signOut();
        throw e;
      }
      return json({ status: "signed_in" });
    }
    if (path === "auth/recovery" && method === "POST") {
      await rateLimit(request, "recovery", 5, 600);
      const p = z
        .object({ email: z.email().max(254) })
        .strict()
        .parse(await bodyJson(request));
      const client = await authClient();
      await client.auth.resetPasswordForEmail(p.email, {
        redirectTo: config().APP_URL + "/auth/callback?next=/reset-password",
      });
      return json({
        status:
          "If this address is eligible, a recovery email will arrive shortly.",
      });
    }
    if (path === "auth/password" && method === "POST") {
      await rateLimit(request, "password-update", 5, 600);
      await requireStaff();
      const p = z
        .object({ password: z.string().min(12).max(200) })
        .strict()
        .parse(await bodyJson(request));
      const client = await authClient(),
        { error } = await client.auth.updateUser(p);
      if (error)
        throw new AppError(
          "PASSWORD_UPDATE_FAILED",
          "Password could not be updated. Request a fresh recovery link.",
        );
      return json({ status: "Password updated." });
    }
    if (path === "auth/logout" && method === "POST") {
      const client = await authClient();
      await client.auth.signOut();
      return json({ status: "signed_out" });
    }
    if (path === "uploads" && method === "POST") {
      await rateLimit(request, "uploads", 20, 600);
      const code = z
        .string()
        .regex(/^JOB-[A-Z0-9]{2,12}-[0-9]{3,6}$/)
        .parse(url.searchParams.get("job_code"));
      return json(
        await saveUpload(
          await boundedBody(request, config().UPLOAD_MAX_BYTES),
          uploadFileName(request),
          request.headers.get("content-type") || "",
          "public",
          code,
        ),
        201,
        requestId,
      );
    }
    if (path === "applications" && method === "POST") {
      await rateLimit(request, "submissions", 30, 600);
      return json(
        await submitApplication(await bodyJson(request), requestId),
        201,
        requestId,
      );
    }
    if (s[0] === "public-jobs" && s.length === 2 && method === "GET") {
      const job = await publicJob(s[1]);
      invariant(job, "NOT_FOUND", "Job not found.", 404);
      return json(job);
    }
    if (
      s[0] === "booking" &&
      s[2] === "slots" &&
      s.length === 3 &&
      method === "GET"
    ) {
      await rateLimit(request, "booking-read", 90);
      return json(await bookingSlots(s[1]), 200, requestId);
    }
    if (path === "interviews/book" && method === "POST") {
      await rateLimit(request, "booking-write", 30, 600);
      return json(
        await book(await bodyJson(request), requestId),
        201,
        requestId,
      );
    }
    const staff = await requireStaff();
    if (path === "jobs" && method === "GET")
      return json(
        await jobsList(
          url.searchParams.get("status") || undefined,
          Number(url.searchParams.get("page")) || 1,
        ),
      );
    if (s[0] === "jobs" && method === "POST")
      return json(
        await saveJob(staff.id, await bodyJson(request), requestId, s[1]),
        s[1] ? 200 : 201,
        requestId,
      );
    if (s[0] === "applications" && s[1]) {
      const id = s[1];
      if (s[2] === "cv" && method === "GET") {
        const file = (
          await query(
            "select u.object_path,u.media_type from applications a join uploads u on u.id=a.cv_upload_id where a.id=$1",
            [id],
          )
        ).rows[0];
        invariant(file, "NOT_FOUND", "CV not found.", 404);
        const { data, error } = await storageClient()
          .storage.from("candidate-cvs")
          .download(file.object_path);
        if (error || !data)
          throw new AppError(
            "FILE_UNAVAILABLE",
            "CV could not be downloaded.",
            503,
            true,
          );
        return new Response(data, {
          headers: {
            "Content-Type": file.media_type,
            "Content-Disposition": `attachment; filename="candidate-cv.${file.media_type === "application/pdf" ? "pdf" : "docx"}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
          },
        });
      }
      if (method === "POST") {
        const raw = await bodyJson(request);
        if (["assign-job", "retry-analysis", "reanalyse"].includes(s[2]))
          return json(
            await applicationAction(
              staff.id,
              id,
              s[2] as "assign-job" | "retry-analysis" | "reanalyse",
              raw,
              requestId,
            ),
          );
        if (s[2] === "hold" || s[2] === "reject")
          return json(
            await decide(
              staff.id,
              id,
              s[2] === "hold" ? "hold" : "rejected",
              raw,
              requestId,
            ),
          );
        if (s[2] === "invite")
          return json(await invite(staff.id, id, raw, requestId));
      }
    }
    if (path === "slots" && method === "POST")
      return json(
        await publishSlot(staff.id, await bodyJson(request), requestId),
        201,
        requestId,
      );
    if (
      s[0] === "interviews" &&
      s[1] &&
      method === "POST" &&
      ["cancel", "reschedule", "retry-sync"].includes(s[2])
    )
      return json(
        await changeInterview(
          staff.id,
          s[1],
          s[2] as "cancel" | "reschedule" | "retry-sync",
          await bodyJson(request),
          requestId,
        ),
      );
    if (s[0] === "notifications" && s[2] === "recover" && method === "POST")
      return json(
        await recoverNotification(
          staff.id,
          s[1],
          await bodyJson(request),
          requestId,
        ),
      );
    if (path === "staff" && method === "GET") {
      await requireStaff(true);
      return json(
        (
          await query(
            "select id,display_name,role,active from staff order by created_at",
          )
        ).rows,
      );
    }
    if (path === "staff" && method === "POST") {
      const p = z
        .object({
          id: z.uuid(),
          role: z.enum(["hr", "admin"]),
          active: z.boolean(),
        })
        .strict()
        .parse(await bodyJson(request));
      invariant(
        p.id !== staff.id,
        "SELF_ACCESS_CHANGE",
        "An administrator cannot change their own access.",
        403,
      );
      await staffTransaction(
        staff.id,
        async (db) => {
          const r = await db.query(
            "update staff set role=$2,active=$3 where id=$1 returning id",
            [p.id, p.role, p.active],
          );
          invariant(r.rowCount, "NOT_FOUND", "Staff member not found.", 404);
          await audit(db, staff.id, "staff.access_changed", p.id, requestId, {
            role: p.role,
            active: p.active,
          });
        },
        true,
      );
      return json({ status: "updated" });
    }
    throw new AppError("NOT_FOUND", "Endpoint not found.", 404);
  });
}
export { handler as GET, handler as POST };
