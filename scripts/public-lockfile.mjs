/**
 * Rewrites package-lock.json "resolved" URLs to the public npm registry.
 *
 * Why: this machine installs through a private npm mirror, so the lockfile records the
 * mirror's URLs. GitHub Actions can't reach the mirror, and the public repo shouldn't
 * contain it. The tarballs (and their integrity hashes) are identical on registry.npmjs.org.
 *
 *   node scripts/public-lockfile.mjs      (run after every npm install, before committing)
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../package-lock.json", import.meta.url);
const PUBLIC = "https://registry.npmjs.org/";
// Any "<host>/…/api/npm/<repo>/" style mirror path (Artifactory, Nexus, …).
const MIRROR = /"resolved": "https:\/\/[^"]+?\/api\/npm\/[^/"]+\//g;

const before = readFileSync(FILE, "utf8");
let count = 0;
const after = before.replace(MIRROR, () => {
  count++;
  return `"resolved": "${PUBLIC}`;
});
writeFileSync(FILE, after);

const leftovers = [...after.matchAll(/"resolved": "(https:\/\/[^/"]+)/g)].map((m) => m[1]).filter((h) => h !== "https://registry.npmjs.org");
console.log(`rewrote ${count} URLs${leftovers.length ? `; still non-public: ${[...new Set(leftovers)].join(", ")}` : ""}`);
process.exit(leftovers.length ? 1 : 0);
