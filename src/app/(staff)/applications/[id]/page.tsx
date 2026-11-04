import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { query } from "@/lib/db";
import { config, configured } from "@/lib/config";
import { dateTime, pageStaff } from "@/lib/view";
import type { Analysis } from "@/lib/contracts";
import { signBooking } from "@/lib/signing";
import { ActionForm } from "@/components/forms";
import { Badge, PageHeader, Setup, Icon } from "@/components/ui";
export default async function ApplicationDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!configured()) return <Setup />;
  await pageStaff();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const a = (
    await query(
      `select a.*,j.title as job_title,j.job_code,u.original_name,u.byte_size,u.scan_status from applications a left join jobs j on j.id=a.job_id join uploads u on u.id=a.cv_upload_id where a.id=$1`,
      [id],
    )
  ).rows[0];
  if (!a) notFound();
  const [
    runsResult,
    staffResult,
    jobsResult,
    historyResult,
    notificationRows,
    invitationRows,
  ] = await Promise.all([
    query(
      "select * from analysis_runs where application_id=$1 order by created_at desc,id desc",
      [id],
    ),
    query(
      "select id,display_name from staff where active=true and calendar_id is not null order by display_name",
    ),
    query(
      "select id,job_code,title from jobs where status='open' order by title limit 500",
    ),
    query(
      `select action,actor,details,created_at from audit_log where object_id=$1 or object_id in(select id from notifications where application_id=$1) order by created_at desc limit 50`,
      [id],
    ),
    query(
      "select id,type,state,attempts,safe_error,provider_id from notifications where application_id=$1 order by created_at desc limit 20",
      [id],
    ),
    query(
      "select id,version,expires_at,consumed_at,revoked_at from invitations where application_id=$1 and revoked_at is null order by created_at desc limit 1",
      [id],
    ),
  ]);
  const runs = runsResult.rows,
    current = runs.find((r) => r.id === a.active_run_id),
    analysis = current?.result?.analysis as Analysis | undefined;
  const invitation = invitationRows.rows[0];
  const inv = invitation
    ? {
        id: String(invitation.id),
        version: Number(invitation.version),
        consumed_at: invitation.consumed_at,
      }
    : undefined;
  return (
    <>
      <PageHeader
        eyebrow={"APPLICATION / " + (a.job_code || "UNMATCHED")}
        title={a.submitted_name}
        description={
          a.job_title || "Assign this email submission to an open job."
        }
        action={
          <Link className="button secondary" href="/candidates">
            Back to candidates
          </Link>
        }
      />
      <div className="detail-layout">
        <div className="detail-main">
          <section className="panel">
            <div className="section-title">
              <h2>Submitted application</h2>
              <Badge value={a.source} />
            </div>
            <dl className="contact-grid">
              <div>
                <dt>Email</dt>
                <dd>{a.submitted_email}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{a.submitted_phone || "Not provided"}</dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>{dateTime(a.created_at)} · Africa/Cairo</dd>
              </div>
              <div>
                <dt>Privacy provenance</dt>
                <dd>
                  {a.consent_at
                    ? `${a.privacy_version} · ${dateTime(a.consent_at)}`
                    : "Email submission — no form consent recorded"}
                </dd>
              </div>
            </dl>
            <div className="cv-card">
              <span className="file-icon">
                {a.original_name.endsWith(".pdf") ? "PDF" : "DOCX"}
              </span>
              <div>
                <strong>{a.original_name}</strong>
                <small>
                  {Math.ceil(a.byte_size / 1024)} KiB · Private ·{" "}
                  {a.scan_status === "clean"
                    ? "Scanned"
                    : "Synthetic unscanned demo file"}
                </small>
              </div>
              <a
                href={"/api/applications/" + id + "/cv"}
                className="button secondary"
              >
                Download original CV <Icon name="arrow" size={16} />
              </a>
            </div>
            {a.contact_ambiguous && (
              <p className="form-error">
                Contact is ambiguous. Keep this in manual review. Request a new
                application through the public job link after verifying the
                candidate’s contact.
              </p>
            )}
          </section>
          <section className="panel">
            <div className="section-title">
              <h2>CV evidence</h2>
              <Badge value={a.processing_status} />
            </div>
            <p className="hint">
              Evidence supports a human review. Missing information is not proof
              of a missing skill.
            </p>
            {analysis ? (
              <>
                <div className="evidence-summary">
                  <span>
                    Extracted name<strong>{analysis.candidate.name}</strong>
                  </span>
                  <span>
                    Experience
                    <strong>
                      {analysis.experience_years.value === null
                        ? "Unknown — not verified"
                        : analysis.experience_years.value +
                          " years (CV evidence)"}
                    </strong>
                  </span>
                </div>
                <div className="evidence-list">
                  {analysis.skills_evidence.map((e) => (
                    <div key={e.skill} className="evidence-item">
                      <div>
                        <strong>{e.skill}</strong>
                        <span
                          className={
                            e.status === "EVIDENCED"
                              ? "evidence-positive"
                              : "muted"
                          }
                        >
                          {e.status === "EVIDENCED"
                            ? "CV evidence found"
                            : "Not mentioned in the CV"}
                        </span>
                      </div>
                      {e.evidence && (
                        <blockquote>
                          {e.evidence}
                          <cite>{e.source?.replaceAll("_", " ")}</cite>
                        </blockquote>
                      )}
                    </div>
                  ))}
                </div>
                <h3>Questions for your review</h3>
                <ul className="questions">
                  {analysis.questions_for_hr.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="processing-state">
                <Icon name="spark" size={26} />
                <h3>
                  {a.processing_status === "queued"
                    ? "Waiting for analysis"
                    : a.processing_status === "processing"
                      ? "Analysis is in progress"
                      : "Human attention needed"}
                </h3>
                <p>
                  {a.processing_status === "queued"
                    ? "The request is durably saved. Start the dispatcher and simulator, or connect the configured workflow."
                    : "Check the saved run status below. The original CV remains available for human review."}
                </p>
              </div>
            )}
          </section>
          {current && (
            <section className="panel">
              <h2>Requirements snapshot</h2>
              <p className="hint">
                Version {current.job_snapshot.requirements_version} · Captured{" "}
                {dateTime(current.created_at)} · Changes to the job do not
                rewrite this run.
              </p>
              <h3>{current.job_snapshot.title}</h3>
              <p className="preserve-lines">
                {current.job_snapshot.description}
              </p>
              <div className="skill-tags">
                {current.job_snapshot.required_skills.map((s: string) => (
                  <span key={s}>{s} · required</span>
                ))}
                {current.job_snapshot.preferred_skills.map((s: string) => (
                  <span key={s}>{s} · preferred</span>
                ))}
              </div>
            </section>
          )}
          <section className="panel">
            <h2>Analysis history</h2>
            {runs.length ? (
              <ul className="history">
                {runs.map((r) => (
                  <li key={r.id}>
                    <span className="timeline-dot" />
                    <div>
                      <strong>
                        Requirements v{r.job_snapshot.requirements_version}
                        {r.id === a.active_run_id ? " · Current run" : ""}
                      </strong>
                      <p>
                        <Badge value={r.status} />{" "}
                        <time>{dateTime(r.created_at)}</time>
                      </p>
                      <small className="hint">Run {r.id}</small>
                      {r.id !== a.active_run_id && r.result?.analysis && (
                        <details>
                          <summary>Previous evidence</summary>
                          <pre className="safe-json">
                            {JSON.stringify(r.result.analysis, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                Analysis starts after a valid job is assigned.
              </p>
            )}
          </section>
          <section className="panel">
            <h2>Activity</h2>
            <ul className="history">
              {historyResult.rows.map((h, i) => (
                <li key={i}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>
                      {h.action.replaceAll(".", " · ").replaceAll("_", " ")}
                    </strong>
                    <p>
                      {dateTime(h.created_at)} ·{" "}
                      {h.actor === "public"
                        ? "Applicant"
                        : h.actor.startsWith("wf")
                          ? h.actor
                          : "Staff"}
                    </p>
                    {h.details.reason && <p>{h.details.reason}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <aside className="detail-aside">
          <section className="panel">
            <span className="eyebrow">HUMAN DECISION</span>
            <h2>Review & next steps</h2>
            <Badge value={a.review_status} />
            <p className="hint">
              A saved decision stays separate from analysis and delivery.
            </p>
            {!a.job_id ? (
              <ActionForm
                endpoint={"/api/applications/" + id + "/assign-job"}
                button="Assign & request analysis"
                tone=""
                fields={[
                  {
                    name: "job_id",
                    label: "Open job",
                    options: jobsResult.rows.map((j) => ({
                      id: j.id,
                      label: j.job_code + " · " + j.title,
                    })),
                  },
                ]}
              />
            ) : (
              <>
                <ActionForm
                  endpoint={"/api/applications/" + id + "/invite"}
                  button="Approve for interview"
                  tone=""
                  fields={[
                    {
                      name: "interviewer_id",
                      label: "Interviewer",
                      options: staffResult.rows.map((s) => ({
                        id: s.id,
                        label: s.display_name,
                      })),
                    },
                    { name: "reason", label: "Review reason" },
                  ]}
                />
                <details className="decision-details">
                  <summary>Hold or reject</summary>
                  <ActionForm
                    endpoint={"/api/applications/" + id + "/hold"}
                    button="Place on hold"
                    fields={[{ name: "reason", label: "Reason for hold" }]}
                  />
                  <ActionForm
                    endpoint={"/api/applications/" + id + "/reject"}
                    button="Reject application"
                    tone="danger"
                    fields={[{ name: "reason", label: "Reason for rejection" }]}
                  />
                </details>
              </>
            )}
          </section>
          <section className="panel">
            <h2>Analysis controls</h2>
            {a.processing_status === "failed_retryable" && (
              <ActionForm
                endpoint={"/api/applications/" + id + "/retry-analysis"}
                button="Retry saved snapshot"
              />
            )}
            {a.job_id &&
              !["queued", "processing"].includes(a.processing_status) && (
                <ActionForm
                  endpoint={"/api/applications/" + id + "/reanalyse"}
                  button="Reanalyse current requirements"
                />
              )}
            <p className="hint">
              Retry preserves the snapshot. Reanalysis creates a new run and
              preserves previous evidence.
            </p>
          </section>
          <section className="panel">
            <h2>Delivery</h2>
            {notificationRows.rows.length ? (
              notificationRows.rows.map((n) => (
                <div className="notification-item" key={n.id}>
                  <strong>{n.type.replaceAll("_", " ")}</strong>
                  <Badge value={n.state} />
                  <p className="hint">
                    {n.attempts} attempts
                    {n.safe_error ? " · " + n.safe_error : ""}
                  </p>
                  {n.state === "failed" && (
                    <ActionForm
                      endpoint={"/api/notifications/" + n.id + "/recover"}
                      button="Retry known failure"
                      fields={[
                        {
                          name: "outcome",
                          label: "Recovery action",
                          options: [
                            {
                              id: "retry_failed",
                              label: "Retry confirmed failure",
                            },
                          ],
                          defaultValue: "retry_failed",
                        },
                        { name: "reason", label: "Failure verified / reason" },
                      ]}
                    />
                  )}
                  {n.state === "unknown" && (
                    <details>
                      <summary>Reconcile with provider</summary>
                      <p className="hint">
                        Look up the message in the provider before choosing. An
                        uncertain send must never be retried blindly.
                      </p>
                      <ActionForm
                        endpoint={"/api/notifications/" + n.id + "/recover"}
                        button="Record reconciliation"
                        fields={[
                          {
                            name: "outcome",
                            label: "Verified provider outcome",
                            options: [
                              {
                                id: "reconciled_sent",
                                label: "Message was sent",
                              },
                              {
                                id: "reconciled_not_sent",
                                label: "Definitely not sent — allow retry",
                              },
                            ],
                          },
                          {
                            name: "provider_id",
                            label: "Provider message ID (required if sent)",
                            required: false,
                          },
                          { name: "reason", label: "Reconciliation evidence" },
                        ]}
                      />
                    </details>
                  )}
                </div>
              ))
            ) : (
              <p className="muted">No notification intents yet.</p>
            )}
            {config().INTEGRATION_MODE === "simulator" &&
              inv &&
              !inv.consumed_at && (
                <div className="notice">
                  <strong>Synthetic demo link</strong>
                  <p>
                    Provider email delivery is simulated. Open this link to test
                    candidate booking.
                  </p>
                  <Link
                    href={
                      "/book/" + signBooking(inv, config().BOOKING_SIGNING_KEY)
                    }
                    target="_blank"
                  >
                    Open booking page ↗
                  </Link>
                </div>
              )}
          </section>
        </aside>
      </div>
    </>
  );
}
