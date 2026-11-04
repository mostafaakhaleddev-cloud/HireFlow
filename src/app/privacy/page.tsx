import { PublicShell } from "@/components/ui";
export default function Privacy() {
  return (
    <PublicShell>
      <main className="narrow panel">
        <span className="eyebrow">LOCAL DEMO · VERSION 2026-11-v1</span>
        <h1>Recruitment privacy notice</h1>
        <p>
          This local development environment is for synthetic applications only.
          Do not submit real personal data.
        </p>
        <p>
          Submitted contact details and CVs are stored privately for the hiring
          team. Automated extraction organizes evidence for human review; it
          does not make hiring decisions.
        </p>
        <p>
          The company must approve its data controller contact, lawful basis,
          retention period, deletion process and final privacy wording before
          private staging with real applicants. This development notice is not a
          production policy.
        </p>
      </main>
    </PublicShell>
  );
}
