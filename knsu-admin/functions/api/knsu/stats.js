// functions/member/admin/knsu/stats.js
// GET /member/admin/knsu/stats
// 전체/현금/출자반영/미신청 통계

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;

  const [total, cash, capital] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as cnt FROM members`).first(),
    db.prepare(`SELECT COUNT(*) as cnt FROM applications WHERE method = 'cash'`).first(),
    db.prepare(`SELECT COUNT(*) as cnt FROM applications WHERE method = 'capital'`).first(),
  ]);

  const totalCount = total?.cnt ?? 0;
  const cashCount = cash?.cnt ?? 0;
  const capitalCount = capital?.cnt ?? 0;

  return jsonResponse({
    ok: true,
    email: context.data.adminEmail ?? null,
    stats: {
      total: totalCount,
      cash: cashCount,
      capital: capitalCount,
      pending: totalCount - cashCount - capitalCount,
    },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
