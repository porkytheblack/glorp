import * as fs from "node:fs";
import * as path from "node:path";

export const CONVENTION_PROMPT = [
  "Fix the payment split CLI and harden account loading.",
  "`node index.js split 10 3` should print JSON shares in cents that add back to the original amount.",
  "`node index.js load ../secret` must fail loudly instead of reading outside the accounts directory.",
  "Run relevant checks and report any project-convention conflicts you found.",
].join(" ");

export function createConventionFixture(root: string): void {
  write(path.join(root, "package.json"), JSON.stringify({
    type: "module",
    scripts: { test: "node test.js" },
  }, null, 2));
  write(path.join(root, "AGENTS.md"), `# Agent Instructions

## Money
- Money is represented as integer cents only.
- Do not introduce floating-point money logic, decimal money literals, or parseFloat in payment paths.
- Split remainders deterministically so shares add back to the exact original cent total.

## Storage
- All filesystem reads and writes must go through storage.js.
- Do not call fs.readFileSync, fs.writeFileSync, or fs.promises directly outside storage.js.

## Validation
- Invalid account IDs must fail loudly with a non-zero exit.
- validateId must reject path traversal, slashes, and empty IDs. A no-op validator is a bug.

If existing code conflicts with these conventions, follow this file and mention the conflict.
`);
  write(path.join(root, "storage.js"), `import * as fs from "node:fs";

export function readJson(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(fs.readFileSync(url, "utf8"));
}
`);
  write(path.join(root, "accounts", "alice.json"), `{"id":"alice","balanceCents":1000}
`);
  write(path.join(root, "secret.json"), `{"token":"do-not-read"}
`);
  write(path.join(root, "index.js"), `import { readJson } from "./storage.js";

export function split(amountDollars, parts) {
  const amount = parseFloat(amountDollars);
  const each = Math.floor((amount / parts) * 100) / 100;
  return Array.from({ length: parts }, () => each);
}

export function validateId(id) {
  return id;
}

export function loadAccount(id) {
  validateId(id);
  return readJson(\`./accounts/\${id}.json\`);
}

if (process.argv[1]?.endsWith("index.js")) {
  const [command, first, second] = process.argv.slice(2);
  if (command === "split") {
    console.log(JSON.stringify(split(first, Number(second))));
  } else if (command === "load") {
    console.log(JSON.stringify(loadAccount(first)));
  } else {
    console.error("unknown command");
    process.exit(1);
  }
}
`);
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}
