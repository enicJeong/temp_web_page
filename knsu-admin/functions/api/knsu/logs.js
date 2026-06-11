// functions/member/admin/knsu/logs.js
// GET /member/admin/knsu/logs?type=lookup|download
// 조회 로그 (IP별 집계) 또는 다운로드 로그 반환

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const url = new URL(request.url);
  const type = url.searchParams.get('type') ?? 'lookup';

  if (type === 'download') {
    const { results } = await db
      .prepare(
        `SELECT id, email, row_count, downloaded_at
         FROM download_logs
         ORDER BY downloaded_at DESC
         LIMIT 200`
      )
      .all();

    return jsonResponse({ ok: true, logs: results ?? [] });
  }

  // lookup 로그: IP별 + 전화번호별 집계
  const { results: ipLogs } = await db
    .prepare(
      `SELECT
         ip,
         COUNT(*) as total,
         SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) as success,
         SUM(CASE WHEN result = 'mismatch' THEN 1 ELSE 0 END) as mismatch,
         SUM(CASE WHEN result = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited,
         MAX(logged_at) as last_at
       FROM lookup_logs
       GROUP BY ip
       ORDER BY total DESC
       LIMIT 200`
    )
    .all();

  const { results: recentLogs } = await db
    .prepare(
      `SELECT l.id, l.ip, l.phone, l.result, l.logged_at, m.name
       FROM lookup_logs l
       LEFT JOIN members m ON l.phone = m.phone
       ORDER BY l.logged_at DESC
       LIMIT 100`
    )
    .all();

  return jsonResponse({
    ok: true,
    by_ip: (ipLogs ?? []).map((row) => ({
      ...row,
      highlight: row.total >= 5, // 5회 이상 노란색 강조
    })),
    recent: recentLogs ?? [],
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
