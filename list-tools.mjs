import { readFileSync, readdirSync } from "node:fs";
const dir = "src/tools";
const files = readdirSync(dir).filter(f => f.endsWith(".ts") && !["index.ts","types.ts"].includes(f));
let total = 0;
const byDomain = {};
for (const f of files) {
  const src = readFileSync(`${dir}/${f}`, "utf8");
  const activePart = src.split("/*")[0];
  const names = [...activePart.matchAll(/name:\s*"(canvas_[a-z_]+)"/g)].map(m => m[1]);
  byDomain[f.replace(".ts","")] = names;
  total += names.length;
}
for (const [d, names] of Object.entries(byDomain)) {
  console.log(`\n## ${d} (${names.length})`);
  names.forEach(n => console.log(`  - ${n}`));
}
console.log(`\nTOTAL ACTIVE: ${total}`);
import { allTools } from "./dist/tools/index.js";
console.log(`runtime allTools.length: ${allTools.length}`);
