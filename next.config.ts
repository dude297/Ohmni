import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Netlify exposes COMMIT_REF only at build time; inline it so /api/health can report the deployed SHA.
  env: { NETLIFY_COMMIT_REF: process.env.COMMIT_REF ?? "" },
  // /api/ac loads the ngspice WASM engine from node_modules at runtime; make serverless bundles include it.
  outputFileTracingIncludes: { "/api/ac": ["./node_modules/eecircuit-engine/**"] },
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
