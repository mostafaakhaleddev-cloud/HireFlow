import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { query } from "@/lib/db";
import { configured } from "@/lib/config";
import { pageStaff } from "@/lib/view";
import { Badge, PageHeader, Setup } from "@/components/ui";
import { JobForm, CopyLink } from "@/components/forms";
export default async function JobDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!configured()) return <Setup />;
  await pageStaff();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const job = (await query("select * from jobs where id=$1", [id])).rows[0];
  if (!job) notFound();
  return (
    <>
      <PageHeader
        eyebrow={job.job_code}
        title={job.title}
        description={"Requirements version " + job.requirements_version}
        action={<Badge value={job.status} />}
      />
      <div className="job-link-bar panel">
        <div>
          <strong>Application link</strong>
          <Link href={"/apply/" + job.job_code} target="_blank">
            /apply/{job.job_code} ↗
          </Link>
        </div>
        <CopyLink code={job.job_code} />
        <Link className="button secondary" href={"/candidates?job=" + job.id}>
          View applications
        </Link>
      </div>
      <JobForm
        id={job.id}
        initial={{
          job_code: job.job_code,
          title: job.title,
          description: job.description,
          required_skills: job.required_skills,
          preferred_skills: job.preferred_skills,
          minimum_years: Number(job.minimum_years),
          status: job.status,
        }}
      />
    </>
  );
}
