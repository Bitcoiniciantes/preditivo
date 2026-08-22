import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: isGitHubPages ? "/preditivo" : "",
  images: { unoptimized: true },
  allowedDevOrigins: ["192.168.1.7", "localhost", "127.0.0.1"],
};

export default nextConfig;