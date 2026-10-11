// Env presence only — never emit key values or lengths.
const on = (k: string) => Boolean(process.env[k]);

export function GET() {
  return Response.json({
    status: 'ok',
    build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.BUILD_SHA ?? 'dev',
    providers: {
      gemini: { configured: on('GEMINI_API_KEY'), model: process.env.GEMINI_MODEL || 'gemini-3.5-flash' },
      groq: { configured: on('GROQ_API_KEY'), model: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b' },
      jev: { configured: on('BEATAPI_API_KEY'), model: process.env.BEATAPI_JEV_MODEL || 'jev-1.13-free' },
    },
  });
}
