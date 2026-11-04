# Staff provisioning

Initial local synthetic admin: `npm run bootstrap`, using randomly generated BOOTSTRAP_EMAIL/PASSWORD from ignored .env.local. Loopback + example.test guard; never hosted bootstrap.

Additional staff use the admin-authenticated operator command:

```powershell
# Put PROVISION_ADMIN_EMAIL / PROVISION_ADMIN_PASSWORD in the restricted operator
# environment or ignored .env.local. Do not put passwords in command arguments.
npm run staff:provision -- teammate@example.test "Synthetic Teammate" hr
```

The command verifies Supabase sign-in plus current active admin membership, generates an Auth invitation without sending mail, saves membership/audit, and writes the secret invitation URL to ignored `test-results/staff-invite-<UUID>.json` with restricted file mode. On Windows restrict the directory ACL as appropriate. Deliver this link only through an explicitly approved private channel; never commit it, paste it in logs or share it publicly. No hosted provisioning or real-person communication has been run in this session.

The invitation callback verifies the one-time Supabase invite token then routes to password setup. Existing access uses admin-only GET/POST `/api/staff` with `{id,role:'hr'|'admin',active:boolean}`; self-access changes are rejected. HR cannot promote/provision. Calendar IDs are set by an authorized operator in staff table and must match the approved interviewer account; they are not writable by HR clients. Hosted provisioning, invitation setup and recovery still require real Supabase verification before launch.
