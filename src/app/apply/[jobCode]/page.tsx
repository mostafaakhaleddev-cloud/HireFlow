import { notFound } from "next/navigation";
import { configured, config } from "@/lib/config";
import { publicJob } from "@/lib/domain";
import { ApplyForm } from "@/components/forms";
import { PublicShell, Setup, Badge } from "@/components/ui";
export const dynamic = "force-dynamic";
export default async function Apply({
  params,
}: {
  params: Promise<{ jobCode: string }>;
}) {
  if (!configured())
    return (
      <PublicShell>
        <Setup />
      </PublicShell>
    );
  const { jobCode } = await params,
    job = await publicJob(jobCode);
  if (!job) notFound();
  return (
    <PublicShell>
      <main className="apply-layout">
        <article className="role-intro">
          <span className="eyebrow">SOFTWARE & IT · {job.job_code}</span>
          <h1>{job.title}</h1>
          <div className="role-meta">
            <Badge value={job.status} />
            <span>{Number(job.minimum_years)}+ years experience</span>
          </div>
          <h2>About the opportunity</h2>
          <p className="preserve-lines">{job.description}</p>
          <h2>What you’ll bring</h2>
          <div className="skill-tags">
            {job.required_skills.map((s: string) => (
              <span key={s}>{s}</span>
            ))}
          </div>
          {job.preferred_skills.length > 0 && (
            <>
              <h2>Nice to have</h2>
              <div className="skill-tags subtle">
                {job.preferred_skills.map((s: string) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
            </>
          )}
          <div className="human-callout">
            <strong>People make our hiring decisions.</strong>
            <p>
              Tools help our team organize evidence. Every application is
              reviewed by a person.
            </p>
          </div>
        </article>
        <section>
          {config().INTEGRATION_MODE === "simulator" && (
            <div className="notice">
              Local synthetic demo · Use synthetic CVs only. Analysis, email and
              Calendar outcomes are simulated.
            </div>
          )}
          {job.status === "open" ? (
            <ApplyForm code={jobCode} />
          ) : (
            <div className="panel">
              <h2>Applications are currently closed.</h2>
              <p>This role is not accepting new applications.</p>
            </div>
          )}
        </section>
      </main>
    </PublicShell>
  );
}
