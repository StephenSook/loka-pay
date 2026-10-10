import path from "node:path";
import type { NextConfig } from "next";

// The repository root. /verify imports two things that live outside web/: the
// payment library (protocol/lib, linked as @lokapay/protocol) and the published test
// vectors (protocol/vectors/payment-v1.json). Turbopack resolves nothing outside its
// root, and it would otherwise pick web/ (the folder with the lockfile).
const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  // No "X-Powered-By: Next.js" header on responses.
  poweredByHeader: false,
  turbopack: { root: repoRoot },
  // Must match turbopack.root, or Next warns and picks one.
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
