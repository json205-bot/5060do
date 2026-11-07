import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve("out");
const HOST = "127.0.0.1";
const PORT = Number(process.env.TEST_VERCEL_PORT ?? 3102);
const DEBUG_PORT = Number(process.env.TEST_VERCEL_DEBUG_PORT ?? 9336);
const OUT_DIR = path.resolve(
  process.env.OUT_DIR ?? path.join("docs", "evidence", "vercel-e2e-20261107"),
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const run = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

const serve = async () => {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      let filePath = path.join(ROOT, pathname);
      if (!filePath.startsWith(ROOT)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      let info = await stat(filePath).catch(() => null);
      if (info?.isDirectory()) {
        filePath = path.join(filePath, "index.html");
        info = await stat(filePath).catch(() => null);
      }
      if (!info?.isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }
      const data = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type":
          MIME[path.extname(filePath).toLowerCase()] ??
          "application/octet-stream",
        "Content-Length": data.length,
      });
      response.end(data);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, resolve);
  });
  return server;
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const buildEnv = { ...process.env, VERCEL: "1", NEXT_PUBLIC_BASE_PATH: "" };
  // Spawn node directly instead of `npm run build`: cmd.exe refuses to run npm
  // scripts while the working directory is a UNC path (\\x4\workspace\...).
  const buildCode = await run(
    process.execPath,
    [path.join("node_modules", "next", "dist", "bin", "next"), "build"],
    buildEnv,
  );
  if (buildCode === 0) {
    await run(
      process.execPath,
      [path.join("scripts", "postbuild-static-rsc.mjs")],
      buildEnv,
    );
  }

  const indexHtml = await readFile(path.join(ROOT, "index.html"), "utf8").catch(
    () => "",
  );
  const rootLeak = indexHtml.includes("/5060do");
  const server = await serve();
  const probe = {};
  try {
    for (const route of ["/", "/classic/"]) {
      const response = await fetch(`http://${HOST}:${PORT}${route}`);
      probe[route] = response.status;
    }
  } finally {
    // Keep the server alive for the E2E run below.
  }

  let verifyCode = 1;
  try {
    verifyCode = await run(
      process.execPath,
      [path.join("scripts", "verify-programs.mjs")],
      {
        ...process.env,
        BASE_PATH: "",
        BASE_ORIGIN: `http://${HOST}:${PORT}`,
        BASE_URL: `http://${HOST}:${PORT}/`,
        OUT_DIR: path.join(OUT_DIR, "programs"),
        DEBUG_PORT: String(DEBUG_PORT),
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const result = {
    basePath: "",
    buildExit: buildCode,
    verifyExit: verifyCode,
    rootLeak,
    probes: probe,
    checkedAt: new Date().toISOString(),
  };
  await writeFile(
    path.join(OUT_DIR, "test-vercel.json"),
    JSON.stringify(result, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(result, null, 2));

  if (buildCode !== 0 || rootLeak || verifyCode !== 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
