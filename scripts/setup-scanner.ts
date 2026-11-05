import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
let env = await readFile(".env.local", "utf8");
for (const [name, value] of Object.entries({
  SCANNER_URL: "http://127.0.0.1:4002/scan",
  SCANNER_TOKEN: randomBytes(32).toString("hex"),
})) {
  const pattern = new RegExp("^" + name + "=.*$", "m");
  if (!pattern.test(env)) env += "\n" + name + "=" + value;
  else if (new RegExp("^" + name + "=\\s*$", "m").test(env))
    env = env.replace(pattern, name + "=" + value);
}
await writeFile(".env.local", env);
console.log("Local scanner configuration saved; values redacted.");
