// functions/member/knsu/_middleware.js
// Rate limiting: 같은 IP에서 1분 10회 초과 시 429 차단
// 모든 /member/knsu/* 경로에 적용

export async function onRequest(context) {
  const { request, env, next } = context;

  // POST 요청에만 rate limit 적용 (GET은 static 파일)
  if (request.method !== 'POST') {
    return next();
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const db = env.DB;

  // 1분 이내 같은 IP 조회 횟수 확인
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19);

  const { results } = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM lookup_logs
       WHERE ip = ? AND logged_at >= ?`
    )
    .bind(ip, oneMinuteAgo)
    .all();

  const count = results[0]?.cnt ?? 0;

  if (count >= 10) {
    // 차단 로그 기록
    await db
      .prepare(
        `INSERT INTO lookup_logs (ip, phone, result) VALUES (?, NULL, 'rate_limited')`
      )
      .bind(ip)
      .run();

    return new Response(
      JSON.stringify({ ok: false, error: '잠시 후 다시 시도해주세요.' }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  return next();
}
