import Link from "next/link";
import type { ReactNode } from "react";

export function Icon({
  name,
  size = 20,
}: {
  name:
    | "jobs"
    | "people"
    | "calendar"
    | "arrow"
    | "plus"
    | "check"
    | "search"
    | "chevron"
    | "spark"
    | "logout";
  size?: number;
}) {
  const paths: Record<string, ReactNode> = {
    jobs: (
      <>
        <rect x="3" y="7" width="18" height="14" rx="3" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a20 20 0 0 0 18 0M12 11v4" />
      </>
    ),
    people: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87" />
        <circle cx="9" cy="7" r="4" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2" />
      </>
    ),
    arrow: <path d="m5 12 14 0m-5-5 5 5-5 5" />,
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="7.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    spark: (
      <>
        <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z" />
      </>
    ),
    logout: (
      <>
        <path d="M9 3H4v18h5M13 7l5 5-5 5M8 12h12" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function Brand() {
  return (
    <Link href="/jobs" className="brand" aria-label="HireFlow home">
      <span className="brand-mark">
        <span />
        <span />
        <span />
      </span>
      HireFlow<span className="brand-ai">AI</span>
    </Link>
  );
}
export function Badge({ value }: { value: string }) {
  return (
    <span className={"badge badge-" + value}>{value.replaceAll("_", " ")}</span>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="jobs" size={27} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Setup({ message }: { message?: string }) {
  return (
    <div className="setup panel">
      <span className="eyebrow">LOCAL DEVELOPMENT</span>
      <h1>Let’s connect your workspace.</h1>
      <p>
        {message ||
          "HireFlow needs local Supabase Auth, PostgreSQL and private Storage before recruiting records can be saved."}
      </p>
      <ol>
        <li>Make Docker available to this project.</li>
        <li>
          <code>npm run db:start</code>
        </li>
        <li>
          <code>npm run setup:local</code>
        </li>
        <li>
          <code>npm run bootstrap</code> and <code>npm run seed</code>
        </li>
        <li>
          Restart <code>npm run dev</code>, then sign in.
        </li>
      </ol>
      <div className="notice">
        No real provider integration is verified. See{" "}
        <code>docs/STATUS.md</code> for actual test results.
      </div>
      <Link href="/login" className="button">
        Go to staff sign in <Icon name="arrow" size={16} />
      </Link>
    </div>
  );
}
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="public-page">
      <header className="public-header">
        <Brand />
        <span>Software & IT · Careers</span>
      </header>
      {children}
      <footer className="public-footer">
        HireFlow AI <span>Thoughtful hiring. Human decisions.</span>
      </footer>
    </div>
  );
}
