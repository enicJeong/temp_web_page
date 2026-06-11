// functions/api/knsu/_middleware.js

export async function onRequest(context) {
  const { request, env, next } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': 'https://admin.knsucoop.com',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  // 1. 이메일 헤더 시도
  let email = request.headers.get('Cf-Access-Authenticated-User-Email');

  // 2. JWT 헤더 시도
  if (!email) {
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (jwt) {
      try {
        const payload = JSON.parse(atob(jwt.split('.')[1]));
        email = payload.email ?? null;
        console.log('JWT email:', email);
      } catch (e) {
        console.error('JWT parse failed:', e);
      }
    }
  }

  // 3. 쿠키에서 JWT 시도
  if (!email) {
    const cookieHeader = request.headers.get('Cookie') ?? '';
    console.log('Cookies:', cookieHeader.substring(0, 200));
    
    const cfJwtMatch = cookieHeader.match(/CF_Authorization=([^;]+)/);
    if (cfJwtMatch) {
      try {
        const payload = JSON.parse(atob(cfJwtMatch[1].split('.')[1]));
        email = payload.email ?? null;
        console.log('Cookie JWT email:', email);
      } catch (e) {
        console.error('Cookie JWT parse failed:', e);
      }
    }
  }

  if (!email) {
    return new Response(
      JSON.stringify({ ok: false, error: '세션이 만료되었습니다. 페이지를 새로고침해주세요.', redirect: true }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': 'https://admin.knsucoop.com',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  }

  const allowedEmails = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!allowedEmails.includes(email.toLowerCase())) {
    return new Response(
      JSON.stringify({ ok: false, error: '접근 권한이 없습니다.' }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': 'https://admin.knsucoop.com',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  }

  context.data.adminEmail = email;
  return next();
}
