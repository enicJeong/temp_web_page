// functions/knsu/_middleware.js
// Rate limiting: KV 기반 (D1 부하 제거)
// 같은 IP에서 1분 10회 초과 시 429 차단

export async function onRequest(context) {
  const { request, env, next } = context;

  if (request.method !== 'POST') return next();

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const kv = env.RATE_LIMIT_KV;

  // KV 없으면 rate limiting 스킵 (바인딩 미설정 대비)
  if (!kv) return next();

  const key = `rl:${ip}`;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1분

  let data;
  try {
    const raw = await kv.get(key);
    data = raw ? JSON.parse(raw) : { count: 0, start: now };
  } catch {
    data = { count: 0, start: now };
  }

  // 윈도우 초과 시 리셋
  if (now - data.start > windowMs) {
    data = { count: 0, start: now };
  }

  data.count += 1;

  if (data.count > 10) {
    // 차단 로그는 비동기
    context.waitUntil(
      env.DB.prepare(`INSERT INTO lookup_logs (ip, phone, result) VALUES (?, NULL, 'rate_limited')`)
        .bind(ip).run()
    );
    return new Response(
      JSON.stringify({ ok: false, error: '잠시 후 다시 시도해주세요.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // KV 업데이트 (TTL 70초 — 1분 윈도우 + 여유)
  context.waitUntil(
    kv.put(key, JSON.stringify(data), { expirationTtl: 70 })
  );

  return next();
}
