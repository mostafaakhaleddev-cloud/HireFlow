import { config, isLoopback } from "../src/lib/config";
const c = config();
if (!isLoopback(c.N8N_WEBHOOK_BASE_URL) || c.INTEGRATION_MODE !== "simulator")
  throw new Error("Local simulator only.");
const mode = process.argv[2] || "normal";
const res = await fetch(
  new URL(
    mode === "reminders" ? "/__reminders" : "/__mode",
    c.N8N_WEBHOOK_BASE_URL,
  ),
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-HireFlow-Secret": c.WEB_TO_N8N_SECRET,
    },
    body: JSON.stringify({ mode }),
  },
);
if (!res.ok) throw new Error("Simulator mode change failed.");
console.log(await res.text());
