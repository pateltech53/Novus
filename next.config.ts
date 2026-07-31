import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The 23MB GLB and mp4 clips are served from public/ as static assets.
  // Three.js examples chunk pulled in by drei is transpiled fine by default.

  // A stray lockfile in the home directory makes Next infer the wrong root.
  outputFileTracingRoot: __dirname,

  // The floating dev-tools badge kept photographing itself into marketing
  // screenshots and demo videos. Nothing it offers is used in this project.
  devIndicators: false,
};

export default nextConfig;
