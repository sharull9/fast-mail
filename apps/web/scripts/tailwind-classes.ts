import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(appDir, "src");
const fix = process.argv.includes("--fix");
const designSystem = await __unstable__loadDesignSystem(await readFile(resolve(srcDir, "styles.css"), "utf8"), {
  base: srcDir,
});
const scanner = new Scanner({ sources: [{ base: srcDir, pattern: "**/*", negated: false }] });
const replacements = new Map<string, string>();

for (const candidate of scanner.scan()) {
  // Preserve px/rem units; normalizing them can change the meaning of custom theme values.
  const [canonical] = designSystem.canonicalizeCandidates([candidate]);
  if (canonical && canonical !== candidate) replacements.set(candidate, canonical);
}

let count = 0;
let changedFiles = 0;
for (const file of [...scanner.files].sort()) {
  let content = await readFile(file, "utf8");
  const changes = scanner
    .getCandidatesWithPositions({ content, extension: extname(file).slice(1) })
    .filter(({ candidate }) => replacements.has(candidate))
    .sort((a, b) => b.position - a.position);
  if (!changes.length) continue;
  changedFiles++;
  let end = content.length;
  for (const { candidate, position } of changes) {
    const canonical = replacements.get(candidate);
    assert(canonical);
    assert(position + candidate.length <= end, `Overlapping candidates in ${file}`);
    assert.equal(
      content.slice(position, position + candidate.length),
      candidate,
      `Invalid candidate position in ${file}`,
    );
    const line = content.slice(0, position).split("\n").length;
    console.log(`${relative(appDir, file)}:${line}: ${candidate} -> ${canonical}`);
    if (fix) content = content.slice(0, position) + canonical + content.slice(position + candidate.length);
    end = position;
    count++;
  }
  if (fix) await writeFile(file, content);
}

console.log(
  count
    ? `${fix ? "Fixed" : "Found"} ${count} noncanonical Tailwind classes in ${changedFiles} files.`
    : "All Tailwind classes are canonical.",
);
if (count && !fix) process.exitCode = 1;
