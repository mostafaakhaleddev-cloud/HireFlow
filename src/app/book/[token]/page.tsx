import { bookingSlots } from "@/lib/scheduling";
import { AppError } from "@/lib/errors";
import { configured } from "@/lib/config";
import { dateTime } from "@/lib/view";
import { BookingForm } from "@/components/forms";
import { Empty, PublicShell, Setup } from "@/components/ui";
export const dynamic = "force-dynamic";
export default async function Booking({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!configured())
    return (
      <PublicShell>
        <Setup />
      </PublicShell>
    );
  const { token } = await params;
  let result;
  try {
    result = await bookingSlots(token);
  } catch (e) {
    if (e instanceof AppError)
      return (
        <PublicShell>
          <main className="narrow panel">
            <h1>This link is no longer available.</h1>
            <p>{e.message}</p>
            <p>Contact the hiring team for a new invitation.</p>
          </main>
        </PublicShell>
      );
    throw e;
  }
  return (
    <PublicShell>
      <main className="booking-layout">
        <div className="booking-intro">
          <span className="eyebrow">LET’S MEET</span>
          <h1>
            A conversation.
            <br />A new possibility.
          </h1>
          <p>
            Choose a 30-minute time that works for you. Your invitation is
            private and can be used once.
          </p>
          <div className="human-callout">
            <strong>Your time, clearly.</strong>
            <p>
              Every slot displays its IANA timezone. Invitation expires{" "}
              {dateTime(result.expires_at)} · Africa/Cairo.
            </p>
          </div>
        </div>
        <section className="panel booking-panel">
          <h2>Find your time</h2>
          <p className="muted">
            All availability is for your assigned interviewer.
          </p>
          {result.slots.length ? (
            <BookingForm
              token={token}
              slots={result.slots.map((s) => ({
                id: s.id,
                starts_at: new Date(s.starts_at).toISOString(),
                timezone: s.timezone,
              }))}
            />
          ) : (
            <Empty
              title="No times available right now."
              description="The hiring team needs to publish more availability. Please check back or contact them."
              action={
                <a className="button secondary" href={"/book/" + token}>
                  Refresh availability
                </a>
              }
            />
          )}
        </section>
      </main>
    </PublicShell>
  );
}
