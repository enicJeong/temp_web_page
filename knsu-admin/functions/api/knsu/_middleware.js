// functions/api/knsu/_middleware.js

export async function onRequest(context) {
  const { request, env, next } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': request.headers.get('Origin') || 'https://admin.knsucoop.com',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  let email = request.headers.get('Cf-Access-Authenticated-User-Email');

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

  // 디버그: 어떤 헤더가 오는지 로그
  console.log('email:', email);
  console.log('jwt exists:', !!request.headers.get('Cf-Access-Jwt-Assertion'));
  console.log('origin:', request.headers.get('Origin'));
  console.log('host:', request.headers.get('Host'));

  if (!email) {
    return new Response(
      JSON.stringify({ ok: false, error: '세션이 만료되었습니다. 페이지를 새로고침해주세요.', redirect: true }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': request.headers.get('Origin') || 'https://admin.knsucoop.com',
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
          'Access-Control-Allow-Origin': request.headers.get('Origin') || 'https://admin.knsucoop.com',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  }

  context.data.adminEmail = email;
  return next();
}
