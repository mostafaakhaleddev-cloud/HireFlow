import { AuthForm } from "@/components/forms";
import { PublicShell } from "@/components/ui";
import { pageStaff } from "@/lib/view";
export const dynamic = "force-dynamic";
export default async function ResetPassword() {
  await pageStaff();
  return (
    <PublicShell>
      <main className="narrow panel">
        <h1>Choose a new password.</h1>
        <p className="muted">Use at least 12 characters.</p>
        <AuthForm mode="reset" />
      </main>
    </PublicShell>
  );
}
