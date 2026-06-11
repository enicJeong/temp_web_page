// functions/admin/knsu/_middleware.js

export async function onRequest(context) {
  const { request, env, next } = context;

  // Preflight OPTIONS 요청은 통과
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': 'https://member.uneedcoop.com',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

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
    // API 요청이면 JSON 반환, 페이지 요청이면 로그인으로 리다이렉트
    const acceptHeader = request.headers.get('Accept') ?? '';
    const isApiRequest = acceptHeader.includes('application/json') ||
      request.headers.get('Content-Type')?.includes('application/json');

    if (isApiRequest) {
      return new Response(
        JSON.stringify({ ok: false, error: '세션이 만료되었습니다. 페이지를 새로고침해주세요.', redirect: true }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': 'https://member.uneedcoop.com',
            'Access-Control-Allow-Credentials': 'true',
          },
        }
      );
    }

    return Response.redirect(`https://member.uneedcoop.com/admin/knsu`, 302);
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
          'Access-Control-Allow-Origin': 'https://member.uneedcoop.com',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  }

  context.data.adminEmail = email;
  return next();
}
