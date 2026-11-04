import { query } from "@/lib/db";
import { config, configured } from "@/lib/config";
import { pageStaff, dateTime } from "@/lib/view";
import { PageHeader, Setup, Badge } from "@/components/ui";
export default async function Operations() {
  if (!configured()) return <Setup />;
  await pageStaff();
  const [events, stuck, notifications] = await Promise.all([
    query(
      "select state,count(*)::int as count,min(created_at) as oldest from integration_events group by state",
    ),
    query(
      "select application_id,id,status,created_at from analysis_runs where status in ('queued','processing') and created_at<now()-interval '15 minutes' order by created_at limit 25",
    ),
    query(
      "select state,count(*)::int as count from notifications where state in ('failed','unknown','sending') group by state",
    ),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="OPERATIONS"
        title="Integration health"
        description="Saved work, workflow acknowledgements, and provider outcomes are tracked separately."
      />
      <div className="notice">
        Mode: <strong>{config().INTEGRATION_MODE}</strong>.{" "}
        {config().INTEGRATION_MODE === "simulator"
          ? "All extraction, email and Calendar outcomes are synthetic."
          : "Live configuration does not prove successful provider integration."}{" "}
        Malware scanner:{" "}
        {config().SCANNER_URL
          ? "configured, operation unverified"
          : "unconfigured — synthetic local use only"}
        .
      </div>
      <section className="panel">
        <h2>Outbox</h2>
        <table>
          <thead>
            <tr>
              <th>State</th>
              <th>Count</th>
              <th>Oldest event</th>
            </tr>
          </thead>
          <tbody>
            {events.rows.map((e) => (
              <tr key={e.state}>
                <td>
                  <Badge value={e.state} />
                </td>
                <td>{e.count}</td>
                <td>{e.oldest ? dateTime(e.oldest) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          Run the separately managed dispatcher with <code>npm run worker</code>
          . Acknowledgement means accepted by the receiver, not completed by the
          workflow.
        </p>
      </section>
      <section className="panel">
        <h2>Stuck analysis requests</h2>
        {stuck.rows.length ? (
          <ul>
            {stuck.rows.map((r) => (
              <li key={r.id}>
                <a href={"/applications/" + r.application_id}>
                  {r.application_id}
                </a>{" "}
                · {r.status} · {dateTime(r.created_at)}
              </li>
            ))}
          </ul>
        ) : (
          <p>No queued or processing runs older than 15 minutes.</p>
        )}
        <p className="hint">
          The worker marks timed-out processing retryable after 30 minutes. Open
          the application and retry its saved snapshot. Exhausted dispatcher
          events can be replayed with the documented operator command.
        </p>
      </section>
      <section className="panel">
        <h2>Delivery attention</h2>
        {notifications.rows.map((n) => (
          <p key={n.state}>
            <Badge value={n.state} /> {n.count}
          </p>
        ))}
        <p>
          Uncertain sends require provider reconciliation before another send is
          allowed. See <code>docs/OPERATIONS.md</code>.
        </p>
      </section>
    </>
  );
}
