import { z } from "zod";
export const uuid = z.uuid();
export const jobCode = z.string().regex(/^JOB-[A-Z0-9]{2,12}-[0-9]{3,6}$/);
const skills = z
  .array(z.string().trim().min(1).max(100))
  .max(40)
  .refine(
    (a) => new Set(a.map((s) => s.toLowerCase())).size === a.length,
    "Duplicate skills",
  );
export const jobSchema = z
  .object({
    job_code: jobCode,
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().min(10).max(15000),
    required_skills: skills.min(1),
    preferred_skills: skills,
    minimum_years: z.coerce.number().min(0).max(60),
    status: z.enum(["draft", "open", "paused", "closed"]),
  })
  .strict()
  .refine(
    (j) =>
      !j.preferred_skills.some((s) =>
        j.required_skills.map((v) => v.toLowerCase()).includes(s.toLowerCase()),
      ),
    "Required and preferred skills must be distinct",
  );
export const applicationSchema = z
  .object({
    job_code: jobCode,
    name: z.string().trim().min(2).max(120),
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    phone: z.string().trim().max(30).optional(),
    consent: z.literal(true),
    privacy_version: z.literal("2026-11-v1"),
    upload_handle: uuid,
    idempotency_key: uuid,
  })
  .strict();
export const intakeSchema = z
  .object({
    schema_version: z.literal(1),
    mailbox_id: z.string().min(1).max(200),
    message_id: z.string().min(1).max(300),
    attachment_id: z.string().min(1).max(300),
    subject: z.string().max(500),
    candidate_name: z.string().min(2).max(120),
    candidate_email: z.email().max(254),
    contact_ambiguous: z.boolean(),
    upload_handle: uuid,
  })
  .strict();
const evidence = z
  .object({
    skill: z.string().min(1).max(100),
    status: z.enum(["EVIDENCED", "NOT_EVIDENCED"]),
    evidence: z.string().min(1).max(3000).nullable(),
    source: z
      .string()
      .regex(/^(cv_page_[1-9]\d{0,3}|docx_(section|paragraph)_[1-9]\d{0,5})$/)
      .nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.status === "EVIDENCED" && (!v.evidence || !v.source))
      c.addIssue({
        code: "custom",
        message: "Positive evidence requires text and source",
      });
    if (
      v.status === "NOT_EVIDENCED" &&
      (v.evidence !== null || v.source !== null)
    )
      c.addIssue({
        code: "custom",
        message: "Missing evidence must be explicit null",
      });
  });
export const analysisSchema = z
  .object({
    candidate: z.object({ name: z.string().min(1).max(120) }).strict(),
    skills_evidence: z.array(evidence).max(80),
    experience_years: z
      .object({
        value: z.number().min(0).max(60).nullable(),
        status: z.enum(["EVIDENCED", "UNVERIFIED"]),
        evidence: z.string().max(2000).optional(),
        source: z
          .string()
          .regex(
            /^(cv_page_[1-9]\d{0,3}|docx_(section|paragraph)_[1-9]\d{0,5})$/,
          )
          .optional(),
      })
      .strict()
      .refine(
        (v) =>
          v.status === "UNVERIFIED"
            ? v.value === null
            : v.value !== null && !!v.evidence && !!v.source,
        "Years require evidence and source; otherwise unknown",
      ),
    questions_for_hr: z.array(z.string().min(1).max(1000)).max(15),
    human_review_required: z.literal(true),
  })
  .strict();
export const resultSchema = z
  .object({
    schema_version: z.literal(1),
    event_id: uuid,
    application_id: uuid,
    analysis_run_id: uuid,
    requirements_version: z.number().int().positive(),
    outcome: z.enum([
      "completed",
      "needs_manual_review",
      "failed_retryable",
      "failed_final",
    ]),
    analysis: analysisSchema.optional(),
    error_code: z
      .enum([
        "UNREADABLE_CV",
        "OCR_REQUIRED",
        "PROVIDER_TIMEOUT",
        "PROVIDER_ERROR",
      ])
      .optional(),
  })
  .strict()
  .refine(
    (v) => v.outcome !== "completed" || !!v.analysis,
    "Completed result requires analysis",
  );
export type Analysis = z.infer<typeof analysisSchema>;
export type JobInput = z.infer<typeof jobSchema>;
export const decisionSchema = z
  .object({ reason: z.string().trim().min(3).max(1000) })
  .strict();
export const inviteSchema = z
  .object({ interviewer_id: uuid, reason: z.string().trim().min(3).max(1000) })
  .strict();
export const slotSchema = z
  .object({
    interviewer_id: uuid,
    starts_at: z.iso.datetime({ offset: true }),
    timezone: z.string().min(1).max(80).default("Africa/Cairo"),
  })
  .strict()
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v.timezone });
      return true;
    } catch {
      return false;
    }
  }, "Invalid timezone");
export const bookSchema = z
  .object({
    token: z.string().min(20).max(1000),
    slot_id: uuid,
    idempotency_key: uuid,
  })
  .strict();
export const notificationResultSchema = z
  .object({
    schema_version: z.literal(1),
    claim_id: uuid,
    outcome: z.enum(["sent", "failed", "unknown"]),
    provider_id: z
      .string()
      .regex(/^[a-zA-Z0-9_:@.\-]{1,250}$/)
      .optional(),
    error_code: z
      .enum(["PROVIDER_ERROR", "TIMEOUT_UNCERTAIN", "RECIPIENT_REJECTED"])
      .optional(),
  })
  .strict()
  .refine(
    (v) => v.outcome !== "sent" || !!v.provider_id,
    "Sent requires provider ID",
  );
export const syncResultSchema = z
  .object({
    schema_version: z.literal(1),
    event_id: uuid,
    revision: z.number().int().positive(),
    operation: z.enum(["create", "reschedule", "cancel"]),
    outcome: z.enum(["confirmed", "cancelled", "failed", "unknown"]),
    provider_event_id: z.string().regex(/^[a-v0-9]{5,1024}$/),
    calendar_id: z.string().min(1).max(254),
    meet_url: z.url().optional(),
    error_code: z
      .enum(["CALENDAR_CONFLICT", "PROVIDER_ERROR", "TIMEOUT_UNCERTAIN"])
      .optional(),
  })
  .strict();
export const eventSchema = z
  .object({
    schema_version: z.literal(1),
    event_id: uuid,
    event_type: z.enum([
      "application.created",
      "application.analysis_requested",
      "interview.invitation_requested",
      "interview.sync_requested",
    ]),
    application_id: uuid.optional(),
    analysis_run_id: uuid.optional(),
    job_id: uuid.optional(),
    source: z.enum(["form", "gmail"]).optional(),
    notification_id: uuid.optional(),
    interview_id: uuid.optional(),
    revision: z.number().int().positive().optional(),
    operation: z.enum(["create", "reschedule", "cancel"]).optional(),
  })
  .strict();
export type IntegrationEvent = z.infer<typeof eventSchema>;
export function validateRequirementEvidence(
  analysis: Analysis,
  snapshot: { required_skills: string[]; preferred_skills: string[] },
) {
  const required = [...snapshot.required_skills, ...snapshot.preferred_skills];
  const actual = analysis.skills_evidence.map((e) => e.skill);
  return (
    actual.length === required.length &&
    new Set(actual).size === actual.length &&
    actual.every((s) => required.includes(s))
  );
}
