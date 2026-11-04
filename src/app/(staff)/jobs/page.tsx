import Link from "next/link";
import { configured } from "@/lib/config";
import { pageStaff, dateOnly } from "@/lib/view";
import { jobsList } from "@/lib/domain";
import { Badge, Empty, Icon, PageHeader, Setup } from "@/components/ui";
export default async function Jobs({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  if (!configured()) return <Setup />;
  await pageStaff();
  const p = await searchParams,
    { jobs, counts } = await jobsList(p.status, Number(p.page) || 1),
    total = counts.reduce((sum, v) => sum + v.count, 0),
    page = Math.max(1, Number(p.page) || 1);
  return (
    <>
      <PageHeader
        eyebrow="BUILD YOUR TEAM"
        title="Jobs"
        description="The right people start with the right opportunity."
        action={
          <Link href="/jobs/new" className="button">
            <Icon name="plus" size={18} />
            Create job
          </Link>
        }
      />
      <div className="summary-strip">
        <span className="summary-icon">
          <Icon name="jobs" size={24} />
        </span>
        <div>
          <strong>{counts.find((c) => c.status === "open")?.count || 0}</strong>
          <span>open opportunities</span>
        </div>
        <p>
          Your next great hire is out there.
          <br />
          <span>Keep every opportunity moving forward.</span>
        </p>
      </div>
      <section className="panel table-panel">
        <div className="table-toolbar">
          <nav className="tabs" aria-label="Filter jobs by status">
            {["all", "open", "paused", "draft", "closed"].map((s) => (
              <Link
                key={s}
                className={(p.status || "all") === s ? "active" : ""}
                href={s === "all" ? "/jobs" : "/jobs?status=" + s}
              >
                {s[0].toUpperCase() + s.slice(1)}
                <span>
                  {s === "all"
                    ? total
                    : counts.find((c) => c.status === s)?.count || 0}
                </span>
              </Link>
            ))}
          </nav>
          <span className="hint">{total} total jobs</span>
        </div>
        {jobs.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Job title</th>
                  <th>Status</th>
                  <th>Applications</th>
                  <th>Requirements</th>
                  <th>Created</th>
                  <th>
                    <span className="sr-only">Open job</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link className="row-title" href={"/jobs/" + j.id}>
                        {j.title}
                      </Link>
                      <small className="cell-sub">
                        {j.job_code} · Software & IT
                      </small>
                    </td>
                    <td>
                      <Badge value={j.status} />
                    </td>
                    <td>
                      <Link
                        className="applicant-count"
                        href={"/candidates?job=" + j.id}
                      >
                        <Icon name="people" size={16} />
                        {j.application_count}
                        <span className="sr-only">
                          {" "}
                          applications for {j.title}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span className="muted">
                        Version {j.requirements_version}
                      </span>
                    </td>
                    <td className="muted">{dateOnly(j.created_at)}</td>
                    <td>
                      <Link
                        className="row-arrow"
                        href={"/jobs/" + j.id}
                        aria-label={"Open " + j.title}
                      >
                        <Icon name="chevron" size={17} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Make room for someone great."
            description="Create a role and share its application link to start receiving CVs."
            action={
              <Link href="/jobs/new" className="button">
                <Icon name="plus" size={17} />
                Create your first job
              </Link>
            }
          />
        )}
        <div className="table-footer">
          <span>
            {jobs.length
              ? `Showing ${(page - 1) * 25 + 1}–${(page - 1) * 25 + jobs.length}`
              : "No jobs to show"}
          </span>
          <div>
            {page > 1 && (
              <Link
                href={
                  "/jobs?" +
                  new URLSearchParams({
                    ...(p.status ? { status: p.status } : {}),
                    page: String(page - 1),
                  })
                }
              >
                Previous
              </Link>
            )}
            {jobs.length === 25 && (
              <Link
                href={
                  "/jobs?" +
                  new URLSearchParams({
                    ...(p.status ? { status: p.status } : {}),
                    page: String(page + 1),
                  })
                }
              >
                Next page →
              </Link>
            )}
          </div>
        </div>
      </section>
      <p className="page-note">
        <Icon name="spark" size={16} />
        Every application keeps the requirements version it was submitted
        against.
      </p>
    </>
  );
}
