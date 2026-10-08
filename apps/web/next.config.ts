import type { NextConfig } from "next";

function apiProxyTarget() {
  const configured =
    process.env.NEXT_SERVER_API_BASE_URL ||
    "http://127.0.0.1:8000";
  return configured.replace(/\/$/, "");
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["172.27.2.90", "100.94.222.54"],
  // 默认的左下角会遮住侧边栏底部的语言与主题切换。
  devIndicators: { position: "bottom-right" },
  experimental: {
    // 代理缓冲上限与后端默认的 4 GiB 视频上传限制一致。
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
