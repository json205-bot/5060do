import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/5060do",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
