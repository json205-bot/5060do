import type { NextConfig } from "next";

// NAS serves the static export under /5060do, Vercel serves it at the root.
// The resolved value is inlined into the client bundle through `env` so that
// asset URLs and hard links can share the same base path.
const basePath =
  process.env.NEXT_PUBLIC_BASE_PATH ?? (process.env.VERCEL ? "" : "/5060do");

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  ...(basePath ? { basePath } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
