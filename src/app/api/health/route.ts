export function GET() {
  return Response.json({ status: 'ok', build: process.env.BUILD_SHA ?? 'dev' });
}
