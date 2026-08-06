import type { NextConfig } from "next";

function apiProxyTarget() {
  const configured =
    process.env.NEXT_SERVER_API_BASE_URL ||
    "http://127.0.0.1:8000";
  return configured.replace(/\/$/, "");
}

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Local video uploads are proxied to the backend through the /api rewrite.
    // Next clones the request body with a 10MB default cap and silently truncates
    // past it, so the backend waits forever for a body that never arrives and the
    // browser reports "Failed to fetch". Keep this above LOCAL_UPLOAD_MAX_BYTES so
    // the backend stays the authoritative limit and can answer 413 properly.
    proxyClientMaxBodySize: "8gb",
    // Multi-GB uploads take far longer than the 30s default proxy timeout.
    proxyTimeout: 3_600_000,
  },
  allowedDevOrigins: ["172.27.2.90", "100.94.222.54"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget()}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
