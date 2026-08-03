import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

const root = process.cwd();
const sourceRoots = [join(root, "app"), join(root, "src")];
const dormantGallery = join(root, "src", "ui", "lightswind");
const allowedImports = new Set([
  "@/ui/lightswind.css",
  "@/ui/lightswind/wave-background",
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (path === dormantGallery) continue;
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    if (entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

const violations = [];
for (const sourceRoot of sourceRoots) {
  for (const path of await sourceFiles(sourceRoot)) {
    const content = await readFile(path, "utf8");
    const specifiers = content.matchAll(/["']([^"']*lightswind[^"']*)["']/g);

    for (const match of specifiers) {
      if (!allowedImports.has(match[1])) {
        violations.push(`${relative(root, path).split(sep).join("/")}: ${match[1]}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    "Dormant Lightswind gallery code cannot enter the runtime without first joining the lint boundary:\n" +
      violations.map((violation) => `- ${violation}`).join("\n"),
  );
  process.exitCode = 1;
}
