import path from "node:path";
import type { NextConfig } from "next";
import { tailnetIp } from "./scripts/tailnet-ip.mjs";

const repoRoot = path.join(process.cwd(), "..", "..");
const tailnet = tailnetIp();

const config: NextConfig = {
  transpilePackages: ["@pulso/contract"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  // Next blocks /_next/* in dev from non-local origins; without this a browser
  // on the tailnet gets the HTML and a dead UI.
  allowedDevOrigins: tailnet ? [tailnet] : [],
  devIndicators: false,
  agentRules: false,
};

export default config;
