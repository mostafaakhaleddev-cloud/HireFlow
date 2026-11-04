import Link from "next/link";
import { query } from "@/lib/db";
import { configured } from "@/lib/config";
import { dateTime, pageStaff } from "@/lib/view";
import { ActionForm, SlotForm } from "@/components/forms";
import { Badge, Empty, PageHeader, Setup } from "@/components/ui";
export default async function Interviews() {
  if (!configured()) return <Setup />;
  await pageStaff();
  const [appointments, staff, slots] = await Promise.all([
    query(
      `select i.*,a.submitted_name,j.title,s.display_name from interviews i join applications a on a.id=i.application_id left join jobs j on j.id=a.job_id join staff s on s.id=i.interviewer_id order by i.starts_at desc,i.id desc limit 100`,
    ),
    query(
      "select id,display_name from staff where active=true and calendar_id is not null order by display_name",
    ),
    query(
      `select s.*,st.display_name,exists(select 1 from reservations r where r.slot_id=s.id) as reserved from interviewer_slots s join staff st on st.id=s.interviewer_id where starts_at>now() order by starts_at limit 100`,
    ),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="MAKE THE CONNECTION"
        title="Interviews"
        description="A clear view of every conversation, from reservation to confirmation."
      />
      <div className="interviews-layout">
        <section className="interview-list">
          {appointments.rows.length ? (
            appointments.rows.map((i) => (
              <article key={i.id} className="panel interview-card">
                <div className="section-title">
                  <div>
                    <Link
                      className="row-title"
                      href={"/applications/" + i.application_id}
                    >
                      {i.submitted_name}
                    </Link>
                    <p className="hint">{i.title}</p>
                  </div>
                  <Badge value={i.state} />
                </div>
                <h3>{dateTime(i.starts_at, i.timezone)}</h3>
                <p className="muted">
                  30 minutes · {i.timezone} · {i.display_name}
                </p>
                <p className="hint">
                  Schedule revision {i.schedule_revision} · Operation:{" "}
                  {i.sync_operation}
                  {i.last_error ? " · " + i.last_error : ""}
                </p>
                {i.meet_url && i.state === "confirmed" && (
                  <a
                    className="button secondary"
                    href={i.meet_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Google Meet ↗
                  </a>
                )}
                {i.pending_slot_id && (
                  <p className="notice">
                    The new slot is held. The original reservation stays in
                    place until Calendar confirms the change.
                  </p>
                )}
                {i.state !== "cancelled" && (
                  <details>
                    <summary>Manage appointment</summary>
                    {i.state === "confirmed" && (
                      <ActionForm
                        endpoint={"/api/interviews/" + i.id + "/reschedule"}
                        button="Request reschedule"
                        fields={[
                          {
                            name: "slot_id",
                            label: "New slot",
                            options: slots.rows
                              .filter(
                                (s) =>
                                  s.interviewer_id === i.interviewer_id &&
                                  !s.reserved,
                              )
                              .map((s) => ({
                                id: s.id,
                                label:
                                  dateTime(s.starts_at, s.timezone) +
                                  " · " +
                                  s.timezone,
                              })),
                          },
                          { name: "reason", label: "Reason for rescheduling" },
                        ]}
                      />
                    )}
                    {["sync_failed", "sync_unknown"].includes(i.state) && (
                      <ActionForm
                        endpoint={"/api/interviews/" + i.id + "/retry-sync"}
                        button="Request provider reconciliation"
                        fields={[
                          { name: "reason", label: "Reconciliation reason" },
                        ]}
                      />
                    )}
                    <ActionForm
                      endpoint={"/api/interviews/" + i.id + "/cancel"}
                      button="Request cancellation"
                      tone="danger"
                      fields={[
                        { name: "reason", label: "Cancellation reason" },
                      ]}
                    />
                    <p className="hint">
                      Cancellation keeps the reservation blocked until the
                      provider confirms. Old reminders are invalidated
                      immediately.
                    </p>
                  </details>
                )}
              </article>
            ))
          ) : (
            <div className="panel">
              <Empty
                title="A little space for a great conversation."
                description="Approve an application for interview and let the candidate choose an available time."
              />
            </div>
          )}
        </section>
        <aside className="detail-aside">
          <section className="panel">
            <SlotForm
              staff={staff.rows.map((s) => ({
                id: s.id,
                label: s.display_name,
              }))}
            />
          </section>
          <section className="panel">
            <h2>Published availability</h2>
            {slots.rows.length ? (
              <ul className="availability-list">
                {slots.rows.map((s) => (
                  <li key={s.id}>
                    <strong>{dateTime(s.starts_at, s.timezone)}</strong>
                    <span>
                      {s.display_name} · {s.timezone}
                    </span>
                    <Badge value={s.reserved ? "reserved" : "available"} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Publish your first 30-minute slot above.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
