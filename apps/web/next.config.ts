import type { NextConfig } from "next";
import path from "node:path";

const workspaceRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  // Keep build-time checking on the compiler API supplied by TypeScript 5.9.
  experimental: { useTypeScriptCli: false },
};

export default nextConfig;
