import type { NextConfig } from "next";

// Enforced CSP, verified on every page route with scripts/csp-smoke.mjs (no violations, no page errors).
// ponytail: 'unsafe-inline' scripts/styles stay because Next's inline RSC/bootstrap scripts need them and nonces would force
// dynamic rendering of the static pages; upgrade path = nonce via proxy + dynamic rendering if XSS risk grows.
// No 'wasm-unsafe-eval' or worker-src: ngspice WASM runs server-side (/api/ac) and the client starts no workers.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Supabase Auth from the browser (saved investigations sign-in, docs/PERSISTENCE.md); data still goes through /api/v1.
  "connect-src 'self' https://*.supabase.co",
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
  { key: "Content-Security-Policy", value: CSP },
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
