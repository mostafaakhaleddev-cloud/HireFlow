"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="setup panel">
      <h1>We couldn’t load this page.</h1>
      <p>
        The service may be unavailable. Your saved records are kept in the
        database.
      </p>
      <button onClick={() => reset()} className="button">
        Try again
      </button>
      <p className="hint">
        Local setup and service dependencies are documented in README.md.
      </p>
    </main>
  );
}
