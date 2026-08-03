import { fileURLToPath } from "node:url";
import { withWorkflow } from "workflow/next";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: workspaceRoot,
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: workspaceRoot },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },
  async redirects() {
    return [
      { source: "/product", destination: "/product/data-connectors", permanent: false },
      { source: "/integrations", destination: "/product/data-connectors", permanent: true },
      { source: "/integrations/:path*", destination: "/product/data-connectors", permanent: true },
      { source: "/workspaces", destination: "/product/workspace-agents", permanent: true },
      { source: "/workspaces/:path*", destination: "/product/workspace-agents", permanent: true },
      { source: "/admin", destination: "/admin/analytics", permanent: false },
      { source: "/success", destination: "/pricing", permanent: false },
      { source: "/cancel", destination: "/pricing", permanent: false },
    ];
  },
};

export default withWorkflow(nextConfig);
