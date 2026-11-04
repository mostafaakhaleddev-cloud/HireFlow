"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import type { JobInput } from "@/lib/contracts";
import { Icon } from "./ui";

class HttpError extends Error {
  constructor(message:string,public status:number,public code:string){super(message);}
}
async function api(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new HttpError(
      data.error?.fields
        ?.map(
          (v: { path: string; message: string }) => `${v.path}: ${v.message}`,
        )
        .join(" · ") ||
        data.error?.message ||
        "Something went wrong. Please retry.",response.status,data.error?.code||'HTTP_ERROR',
    );
  return data;
}
export function Logout() {
  const router = useRouter();
  return (
    <button
      className="logout"
      onClick={async () => {
        await api("/api/auth/logout", {});
        router.push("/login");
        router.refresh();
      }}
    >
      <Icon name="logout" size={18} />
      Sign out
    </button>
  );
}
export function AuthForm({
  mode = "login",
}: {
  mode?: "login" | "recovery" | "reset";
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const result = await api(
        "/api/auth/" +
          (mode === "login"
            ? "login"
            : mode === "recovery"
              ? "recovery"
              : "password"),
        mode === "reset"
          ? { password: f.get("password") }
          : mode === "recovery"
            ? { email: f.get("email") }
            : { email: f.get("email"), password: f.get("password") },
      );
      if (mode === "login") {
        router.push("/jobs");
        router.refresh();
      } else setSuccess(result.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form-stack">
      {mode !== "reset" && (
        <label>
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
            maxLength={254}
          />
        </label>
      )}
      {mode !== "recovery" && (
        <label>
          {mode === "reset" ? "New password" : "Password"}
          <input
            name="password"
            type="password"
            autoComplete={
              mode === "reset" ? "new-password" : "current-password"
            }
            required
            minLength={mode === "reset" ? 12 : 8}
            maxLength={200}
          />
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="notice" role="status">
          {success}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy
          ? "Please wait…"
          : mode === "login"
            ? "Sign in to workspace"
            : mode === "recovery"
              ? "Send recovery link"
              : "Update password"}
        <Icon name="arrow" size={16} />
      </button>
    </form>
  );
}
export function JobForm({ initial, id }: { initial?: JobInput; id?: string }) {
  const router = useRouter(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const list = (key: string) =>
      String(f.get(key))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    try {
      const data = await api("/api/jobs" + (id ? "/" + id : ""), {
        job_code: f.get("job_code"),
        title: f.get("title"),
        description: f.get("description"),
        required_skills: list("required_skills"),
        preferred_skills: list("preferred_skills"),
        minimum_years: Number(f.get("minimum_years")),
        status: f.get("status"),
      });
      router.push("/jobs/" + data.id);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="panel form-stack job-form">
      <div className="form-section">
        <h2>Role details</h2>
        <p>Make the role clear from the first impression.</p>
      </div>
      <div className="form-grid">
        <label>
          Job title
          <input
            name="title"
            defaultValue={initial?.title}
            placeholder="Backend Engineer"
            minLength={2}
            maxLength={160}
            required
          />
        </label>
        <label>
          Stable job code
          <input
            name="job_code"
            defaultValue={initial?.job_code}
            placeholder="JOB-BE-001"
            pattern="JOB-[A-Z0-9]{2,12}-[0-9]{3,6}"
            title="For example, JOB-BE-001"
            readOnly={!!id}
            required
          />
        </label>
      </div>
      <label>
        Description
        <textarea
          name="description"
          rows={6}
          minLength={10}
          maxLength={15000}
          defaultValue={initial?.description}
          placeholder="What will this person work on?"
          required
        />
      </label>
      <div className="form-section">
        <h2>Matching requirements</h2>
        <p>
          Changes create a new version. Submitted applications keep their
          original snapshot.
        </p>
      </div>
      <label>
        Required skills{" "}
        <span className="hint">Separate skills with commas</span>
        <input
          name="required_skills"
          defaultValue={initial?.required_skills.join(", ")}
          placeholder="ASP.NET Core, PostgreSQL"
          required
        />
      </label>
      <label>
        Preferred skills
        <input
          name="preferred_skills"
          defaultValue={initial?.preferred_skills.join(", ")}
          placeholder="Docker, Azure"
        />
      </label>
      <div className="form-grid">
        <label>
          Minimum experience (years)
          <input
            name="minimum_years"
            type="number"
            min="0"
            max="60"
            step="0.5"
            defaultValue={initial?.minimum_years || 0}
            required
          />
        </label>
        <label>
          Job status
          <select name="status" defaultValue={initial?.status || "open"}>
            {["draft", "open", "paused", "closed"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        <span className="muted">Only open jobs accept applications.</span>
        <button className="button" disabled={busy}>
          {busy ? "Saving…" : id ? "Save changes" : "Create job"}
          <Icon name="check" size={16} />
        </button>
      </div>
    </form>
  );
}
export function CopyLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        className="button secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              window.location.origin + "/apply/" + code,
            );
            setCopied(true);
          } catch {
            setError("Copy the application link from the link below.");
          }
        }}
      >
        {copied ? "Link copied" : "Copy application link"}
      </button>
      <span role="status" className="hint">
        {error}
      </span>
    </>
  );
}
export function ApplyForm({ code }: { code: string }) {
  const [busy, setBusy] = useState(false),
    [phase, setPhase] = useState(""),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState("");
  const [key] = useState(() => crypto.randomUUID()),
    [handle, setHandle] = useState<string>();
  const [acceptedPayload, setAcceptedPayload] =
    useState<Record<string, unknown>>();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const file = f.get("cv") as File;
    try {
      let upload = handle;
      if (!upload) {
        if (!file?.size || file.size > 5 * 1024 * 1024)
          throw new Error("Choose a PDF or DOCX up to 5 MiB.");
        setPhase("Uploading and verifying your CV…");
        const res = await fetch(
          "/api/uploads?job_code=" + encodeURIComponent(code),
          {
            method: "POST",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "X-File-Name": encodeURIComponent(file.name),
            },
            body: file,
          },
        );
        const data = await res.json();
        if (!res.ok)
          throw new Error(data.error?.message || "CV upload failed.");
        upload = data.upload_handle;
        setHandle(upload);
      }
      setPhase("Saving your application…");
      const payload = acceptedPayload || {
        job_code: code,
        name: f.get("name"),
        email: f.get("email"),
        phone: f.get("phone") || "",
        consent: f.get("consent") === "on",
        privacy_version: "2026-11-v1",
        upload_handle: upload,
        idempotency_key: key,
      };
      setAcceptedPayload(payload);
      const data = await api("/api/applications", payload);
      setReceipt(data.receipt);
    } catch (e) {
      if(e instanceof HttpError&&(e.status===400||e.code==='UPLOAD_INVALID')){
        setAcceptedPayload(undefined);
        if(e.code==='UPLOAD_INVALID')setHandle(undefined);
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setPhase("");
    }
  }
  if (receipt)
    return (
      <div className="panel application-success" role="status">
        <span className="success-check">
          <Icon name="check" size={32} />
        </span>
        <h2>Your application is in.</h2>
        <p>
          Thank you for your interest. Our hiring team will review your
          application and contact you about next steps.
        </p>
        <p className="hint">
          Receipt: <code>{receipt}</code>
        </p>
        <p>There’s nothing else you need to do right now.</p>
      </div>
    );
  return (
    <form className="panel form-stack" onSubmit={submit}>
      <div>
        <span className="eyebrow">YOUR NEXT CHAPTER</span>
        <h2>Apply for this role</h2>
        <p className="muted">
          A few details, and your latest CV. No account needed.
        </p>
      </div>
      <fieldset disabled={busy || !!acceptedPayload} className="form-stack">
        <label>
          Full name
          <input
            name="name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={120}
          />
        </label>
        <div className="form-grid">
          <label>
            Email address
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label>
            Phone <span className="hint">Optional</span>
            <input name="phone" type="tel" autoComplete="tel" maxLength={30} />
          </label>
        </div>
        <label className="file-upload">
          Your CV
          <input
            name="cv"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            required
            onChange={() => setHandle(undefined)}
          />
          <span className="hint">
            PDF or DOCX · Up to 5 MiB · Private to the hiring team
          </span>
        </label>
        <label className="checkbox">
          <input name="consent" type="checkbox" required />
          <span>
            I agree that the hiring team may process my application and CV for
            recruitment.{" "}
            <a href="/privacy" target="_blank" rel="noreferrer">
              Privacy notice
            </a>
          </span>
        </label>
      </fieldset>
      {acceptedPayload && (
        <p className="hint">
          Your submission details are locked for a safe retry. A retry will use
          the same application key.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy} className="button">
        {busy
          ? phase
          : acceptedPayload
            ? "Retry submission"
            : "Submit application"}
        <Icon name="arrow" size={16} />
      </button>
      <p className="hint">Every hiring decision is made by a person.</p>
    </form>
  );
}
type Option = { id: string; label: string };
export function ActionForm({
  endpoint,
  button,
  fields = [],
  tone = "secondary",
}: {
  endpoint: string;
  button: string;
  fields?: {
    name: string;
    label: string;
    type?: string;
    options?: Option[];
    required?: boolean;
    defaultValue?: string;
  }[];
  tone?: string;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    const f = new FormData(e.currentTarget),
      payload = Object.fromEntries(f.entries());
    try {
      await api(endpoint, payload);
      setSuccess("Saved.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form-stack compact">
      {fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.options ? (
            <select
              name={f.name}
              required={f.required !== false}
              defaultValue={f.defaultValue || ""}
            >
              <option value="" disabled>
                Choose…
              </option>
              {f.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              name={f.name}
              type={f.type || "text"}
              required={f.required !== false}
              minLength={f.name === "reason" ? 3 : undefined}
              maxLength={1000}
              defaultValue={f.defaultValue}
            />
          )}
        </label>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="hint" role="status">
          {success}
        </p>
      )}
      <button disabled={busy} className={"button " + tone}>
        {busy ? "Saving…" : button}
      </button>
    </form>
  );
}
export function SlotForm({ staff }: { staff: Option[] }) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ok, setOk] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const date = new Date(String(f.get("starts_at")));
      await api("/api/slots", {
        interviewer_id: f.get("interviewer_id"),
        starts_at: date.toISOString(),
        timezone: f.get("timezone"),
      });
      setOk("30-minute slot published.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form-stack">
      <h2>Publish availability</h2>
      <p className="hint">
        Choose a time in your device timezone:{" "}
        {Intl.DateTimeFormat().resolvedOptions().timeZone}. It is saved as a UTC
        instant.
      </p>
      <label>
        Interviewer
        <select name="interviewer_id" required>
          <option value="">Choose…</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Slot start <input name="starts_at" type="datetime-local" required />
      </label>
      <label>
        Display timezone
        <select name="timezone" defaultValue="Africa/Cairo">
          <option>Africa/Cairo</option>
          <option>UTC</option>
          <option>Europe/London</option>
          <option>America/New_York</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {ok && (
        <p role="status" className="notice">
          {ok}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? "Publishing…" : "Publish 30-minute slot"}
      </button>
    </form>
  );
}
export function BookingForm({
  token,
  slots,
}: {
  token: string;
  slots: { id: string; starts_at: string; timezone: string }[];
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState(""),
    [key] = useState(() => crypto.randomUUID()),
    [selected, setSelected] = useState(""),
    [locked, setLocked] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setLocked(true);
    try {
      const r = await api("/api/interviews/book", {
        token,
        slot_id: selected,
        idempotency_key: key,
      });
      setReceipt(r.receipt);
    } catch (e) {
      const message = (e as Error).message;
      setError(
        message,
      ); /* Preserve the operation on uncertain network failures. */
    } finally {
      setBusy(false);
    }
  }
  if (receipt)
    return (
      <div className="application-success" role="status">
        <span className="success-check">
          <Icon name="check" size={32} />
        </span>
        <h2>Your time is reserved.</h2>
        <p>
          Calendar confirmation is pending. The hiring team will follow up with
          your meeting details.
        </p>
        <p className="hint">
          Receipt: <code>{receipt}</code>
        </p>
      </div>
    );
  return (
    <form onSubmit={submit} className="form-stack">
      <fieldset disabled={busy || locked}>
        <legend>Available 30-minute interviews</legend>
        <div className="slot-options">
          {slots.map((s) => (
            <label
              className={"slot-option " + (selected === s.id ? "selected" : "")}
              key={s.id}
            >
              <input
                type="radio"
                name="slot"
                value={s.id}
                checked={selected === s.id}
                onChange={() => setSelected(s.id)}
                required
              />
              <span>
                {new Intl.DateTimeFormat("en-GB", {
                  timeZone: s.timezone,
                  dateStyle: "full",
                  timeStyle: "short",
                }).format(new Date(s.starts_at))}
                <small>{s.timezone}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error} <a href={window.location.pathname}>Refresh availability</a>
        </p>
      )}
      <button disabled={busy || !selected} className="button">
        {busy
          ? "Reserving…"
          : locked
            ? "Retry this reservation"
            : "Confirm interview time"}
        <Icon name="arrow" size={16} />
      </button>
    </form>
  );
}
