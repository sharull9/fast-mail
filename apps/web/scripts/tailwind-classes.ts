import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(appDir, "src");
const fix = process.argv.includes("--fix");
const css = await readFile(resolve(srcDir, "styles.css"), "utf8");
// Tailwind caches canonicalization per design system regardless of options, so the plain and
// rem-normalized passes each need their own instance.
const designSystem = await __unstable__loadDesignSystem(css, { base: srcDir });
const remDesignSystem = await __unstable__loadDesignSystem(css, { base: srcDir });
const scanner = new Scanner({ sources: [{ base: srcDir, pattern: "**/*", negated: false }] });
const replacements = new Map<string, string>();

// A theme value is only statically known if it doesn't defer to another variable. E.g. `--radius-lg:
// var(--radius)` resolves against Tailwind's default `--radius` (0.25rem) at build time, while
// `:root` overrides it to 0.625rem at runtime, so `rounded-[4px] -> rounded-lg` would be wrong.
function usesOnlyStaticThemeValues(candidate: string) {
  const [cssCandidate] = designSystem.candidatesToCss([candidate]);
  const css = cssCandidate ?? "";
  return [...css.matchAll(/var\((--[\w-]+)/g)].every(([, name]) => {
    if (name.startsWith("--tw-")) return true; // Tailwind internals, e.g. `--tw-content` for `after:`.
    const value = designSystem.theme.get([name as `--${string}`]);
    return value != null && !value.includes("var(");
  });
}

for (const candidate of scanner.scan()) {
  const [canonical] = designSystem.canonicalizeCandidates([candidate]);
  // Match Tailwind IntelliSense (suggestCanonicalClasses), which uses a 16px root font size so
  // arbitrary px values like `w-[640px]` map onto theme scales (`w-160`). Only accept those
  // px-derived rewrites when the target utility's theme values are static.
  const [remCanonical] = remDesignSystem.canonicalizeCandidates([candidate], { rem: 16 });
  const best = remCanonical !== canonical && usesOnlyStaticThemeValues(remCanonical) ? remCanonical : canonical;
  if (best && best !== candidate) replacements.set(candidate, best);
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
