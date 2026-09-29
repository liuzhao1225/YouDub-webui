import type { NextConfig } from "next";

function apiProxyTarget() {
  const configured =
    process.env.NEXT_SERVER_API_BASE_URL ||
    "http://127.0.0.1:8000";
  return configured.replace(/\/$/, "");
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["172.27.2.90", "100.94.222.54"],
  experimental: {
    // 本地视频经 Next.js 代理上传到后端；默认只缓冲 10MB，需与后端 LOCAL_UPLOAD_MAX_BYTES（默认 4 GiB，v1 Runtime 的 max_file_bytes 也取这个值）一致。
    proxyClientMaxBodySize: "4gb",
  },
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
