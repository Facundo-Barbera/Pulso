import path from "node:path";
import type { NextConfig } from "next";
import { tailnetCertDomain, tailnetIp } from "./scripts/tailnet-ip.mjs";

const repoRoot = path.join(process.cwd(), "..", "..");
const tailnet = [tailnetIp(), tailnetCertDomain()].filter((host): host is string => Boolean(host));

const config: NextConfig = {
  transpilePackages: ["@pulso/contract"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  // Next blocks /_next/* in dev from non-local origins; without this a browser
  // on the tailnet gets the HTML and a dead UI.
  allowedDevOrigins: tailnet,
  devIndicators: false,
  agentRules: false,
};

export default config;
