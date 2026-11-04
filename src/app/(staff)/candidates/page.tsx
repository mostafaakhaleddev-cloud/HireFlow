import Link from "next/link";
import { candidatesList } from "@/lib/domain";
import { query } from "@/lib/db";
import { configured } from "@/lib/config";
import { dateOnly, pageStaff } from "@/lib/view";
import { Badge, Empty, Icon, PageHeader, Setup } from "@/components/ui";
export default async function Candidates({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (!configured()) return <Setup />;
  await pageStaff();
  const filters = await searchParams,
    { applications, count, page } = await candidatesList(filters),
    jobs = (
      await query("select id,title,job_code from jobs order by title limit 500")
    ).rows;
  const pageLink = (p: number) =>
    "/candidates?" +
    new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(filters).filter((e): e is [string, string] => !!e[1]),
      ),
      page: String(p),
    });
  return (
    <>
      <PageHeader
        eyebrow="PEOPLE & POSSIBILITIES"
        title="Candidates"
        description="Every application has its own story. Review the evidence, then decide."
      />
      <section className="panel table-panel">
        <form className="candidate-filters" method="get">
          <label className="search-field">
            <span className="sr-only">Search name or email</span>
            <Icon name="search" size={18} />
            <input
              type="search"
              name="q"
              placeholder="Search name or email…"
              defaultValue={filters.q}
            />
          </label>
          <label>
            <span className="sr-only">Job</span>
            <select name="job" defaultValue={filters.job || ""}>
              <option value="">All jobs</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.job_code} · {j.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Source</span>
            <select name="source" defaultValue={filters.source || ""}>
              <option value="">All sources</option>
              <option value="form">Application form</option>
              <option value="gmail">Gmail intake</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Processing status</span>
            <select name="processing" defaultValue={filters.processing || ""}>
              <option value="">All processing</option>
              {[
                "queued",
                "processing",
                "completed",
                "needs_manual_review",
                "failed_retryable",
                "failed_final",
              ].map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Review status</span>
            <select name="review" defaultValue={filters.review || ""}>
              <option value="">All decisions</option>
              {[
                "needs_job_assignment",
                "awaiting_review",
                "hold",
                "interview_approved",
                "rejected",
              ].map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary">Filter</button>
          <Link href="/candidates" className="text-link">
            Clear
          </Link>
        </form>
        <div className="list-caption">
          <strong>{count} applications</strong>
          <span>One row per application · Individual CVs and evidence</span>
        </div>
        {applications.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Opportunity</th>
                  <th>Source</th>
                  <th>Processing</th>
                  <th>Review</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link
                        href={"/applications/" + a.id}
                        className="row-title"
                      >
                        {a.submitted_name}
                      </Link>
                      <small className="cell-sub">{a.submitted_email}</small>
                    </td>
                    <td>
                      {a.job_title || "Needs job assignment"}
                      <small className="cell-sub">
                        {a.job_code || "Unmatched intake"}
                      </small>
                    </td>
                    <td>
                      <Badge value={a.source} />
                    </td>
                    <td>
                      <Badge value={a.processing_status} />
                    </td>
                    <td>
                      <Badge value={a.review_status} />
                    </td>
                    <td className="muted">{dateOnly(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="A fresh start."
            description="Applications will appear here as candidates apply or email CVs arrive."
          />
        )}
        <div className="table-footer">
          <span>
            {count
              ? `Showing ${(page - 1) * 25 + 1}–${Math.min(page * 25, count)} of ${count}`
              : "No matching applications"}
          </span>
          <div>
            {page > 1 && <Link href={pageLink(page - 1)}>Previous</Link>}
            {page * 25 < count && (
              <Link href={pageLink(page + 1)}>Next page →</Link>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
