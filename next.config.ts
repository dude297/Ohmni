import type { NextConfig } from "next";

// ponytail: CSP is Report-Only until verified against every route (Next inline scripts, R3F/WebGL, ngspice WASM); enforce once the console is clean.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Voice Lab uses speech recognition (microphone, same origin only). Nothing uses the camera.
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy-Report-Only", value: CSP },
];

const nextConfig: NextConfig = {
  /* config options here */
  // Netlify exposes COMMIT_REF only at build time; inline it so /api/health can report the deployed SHA.
  env: { NETLIFY_COMMIT_REF: process.env.COMMIT_REF ?? "" },
  // /api/ac loads the ngspice WASM engine from node_modules at runtime; make serverless bundles include it.
  outputFileTracingIncludes: { "/api/ac": ["./node_modules/eecircuit-engine/**"] },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
