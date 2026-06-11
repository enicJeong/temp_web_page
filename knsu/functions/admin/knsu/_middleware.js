// functions/admin/knsu/_middleware.js
// Cloudflare Access JWT에서 이메일 직접 추출

export async function onRequest(context) {
  const { request, env, next } = context;

  // 1. 이메일 헤더 시도
  let email = request.headers.get('Cf-Access-Authenticated-User-Email');

  // 2. 헤더 없으면 JWT 파싱
  if (!email) {
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (jwt) {
      try {
        const payload = JSON.parse(atob(jwt.split('.')[1]));
        email = payload.email ?? null;
      } catch (e) {
        console.error('JWT parse failed:', e);
      }
    }
  }

  if (!email) {
    return new Response(
      JSON.stringify({ ok: false, error: '인증이 필요합니다.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const allowedEmails = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!allowedEmails.includes(email.toLowerCase())) {
    return new Response(
      JSON.stringify({ ok: false, error: '접근 권한이 없습니다.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  context.data.adminEmail = email;
  return next();
}
