import { geminiModel } from '@/lib/ai/gemini';
import { groqModel } from '@/lib/ai/groq';
// Env presence only — never emit key values or lengths.
const on = (k: string) => Boolean(process.env[k]);

export function GET() {
  return Response.json({
    status: 'ok',
    build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.BUILD_SHA ?? 'dev',
    visionPrimary: process.env.VISION_PRIMARY === 'gemini' ? 'gemini' : 'groq',
    providers: {
      gemini: { configured: on('GEMINI_API_KEY'), model: geminiModel() },
      groq: { configured: on('GROQ_API_KEY'), model: groqModel() },
      jev: { configured: on('BEATAPI_API_KEY'), model: process.env.BEATAPI_JEV_MODEL || 'jev-1.13-free' },
    },
  });
}
