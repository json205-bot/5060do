import { copyFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve("out");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("__next.")) {
      const payload = path.join(fullPath, "__PAGE__.txt");
      try {
        const info = await stat(payload);
        if (info.isFile()) {
          const target = path.join(dir, `${entry.name}.__PAGE__.txt`);
          await copyFile(payload, target);
          console.log(
            `[postbuild] ${path.relative(OUT_DIR, target)} <- ${path.relative(
              OUT_DIR,
              payload,
            )}`,
          );
        }
      } catch {
        // Directory without a page payload; nothing to mirror.
      }
    }
    await walk(fullPath);
  }
}

await walk(OUT_DIR);
