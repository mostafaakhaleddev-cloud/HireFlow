import Link from "next/link";
import { AuthForm } from "@/components/forms";
import { PublicShell } from "@/components/ui";
export default function Recover() {
  return (
    <PublicShell>
      <main className="narrow panel">
        <h1>Reset your password.</h1>
        <p className="muted">
          We’ll send a recovery link if your address is eligible.
        </p>
        <AuthForm mode="recovery" />
        <Link href="/login">Back to sign in</Link>
      </main>
    </PublicShell>
  );
}
