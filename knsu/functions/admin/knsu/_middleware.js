// functions/admin/knsu/_middleware.js

export async function onRequest(context) {
  const { request, env, next } = context;

  // 모든 CF 관련 헤더 로깅
  const cfEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
  const cfJwt = request.headers.get('Cf-Access-Jwt-Assertion');
  
  console.log('CF-Email:', cfEmail);
  console.log('CF-JWT exists:', !!cfJwt);

  if (!cfEmail) {
    return new Response(
      JSON.stringify({ ok: false, error: '인증이 필요합니다.', debug: { jwt: !!cfJwt } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const allowedEmails = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!allowedEmails.includes(cfEmail.toLowerCase())) {
    return new Response(
      JSON.stringify({ ok: false, error: '접근 권한이 없습니다.', email: cfEmail }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  context.data.adminEmail = cfEmail;
  return next();
}
