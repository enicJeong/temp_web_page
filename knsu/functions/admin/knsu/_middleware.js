// functions/member/admin/knsu/_middleware.js
// 관리자 인증: Cloudflare Access 헤더 검증 + ADMIN_EMAILS 환경변수 대조
// 모든 /member/admin/knsu/* 경로에 적용

export async function onRequest(context) {
  const { request, env, next } = context;

  const email = request.headers.get('Cf-Access-Authenticated-User-Email');

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
