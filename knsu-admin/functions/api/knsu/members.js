// functions/api/knsu/members.js
// GET  /api/knsu/members?page=1&search=&method=&sort=date|name
// POST /api/knsu/members/phone  { phone, new_phone }  전화번호 수정

const PAGE_SIZE = 25;

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const url = new URL(request.url);
  const page   = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const search = (url.searchParams.get('search') ?? '').trim();
  const method = (url.searchParams.get('method') ?? '').trim();
  const sort   = url.searchParams.get('sort') ?? 'date'; // date | name
  const offset = (page - 1) * PAGE_SIZE;

  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(m.name LIKE ? OR m.phone LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like);
  }
  if (method === 'cash')    conditions.push("a.method = 'cash'");
  else if (method === 'capital') conditions.push("a.method = 'capital'");
  else if (method === 'pending') conditions.push('a.method IS NULL');

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const orderBy = sort === 'name'
    ? 'ORDER BY m.name COLLATE NOCASE ASC'
    : 'ORDER BY a.applied_at DESC NULLS LAST, m.name ASC';

  const [countResult, listResult] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as cnt FROM members m LEFT JOIN applications a ON m.phone = a.phone ${where}`)
      .bind(...params).first(),
    db.prepare(`
      SELECT m.phone, m.name,
        m.div_capital, m.div_usage, m.div_total,
        m.tax_income, m.tax_local, m.div_net,
        a.method, a.applicant_name, a.bank, a.account,
        a.ssn_encrypted, a.ssn_iv,
        a.consent1_at, a.consent2_at, a.consent3_at,
        a.phone_changed, a.capital_at,
        a.applied_at, a.updated_at
      FROM members m
      LEFT JOIN applications a ON m.phone = a.phone
      ${where}
      ${orderBy}
      LIMIT ? OFFSET ?
    `).bind(...params, PAGE_SIZE, offset).all(),
  ]);

  const total = countResult?.cnt ?? 0;
  const rows  = (listResult.results ?? []).map(maskRow);

  return jsonResponse({ ok: true, total, page, page_size: PAGE_SIZE, total_pages: Math.ceil(total / PAGE_SIZE), rows });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, error: '잘못된 요청' }, 400); }

  const phone     = String(body.phone ?? '').replace(/\D/g, '');
  const new_phone = String(body.new_phone ?? '').replace(/\D/g, '');

  if (!phone || !new_phone) return jsonResponse({ ok: false, error: '전화번호를 입력해주세요.' }, 400);
  if (new_phone.length < 10)  return jsonResponse({ ok: false, error: '전화번호가 올바르지 않습니다.' }, 400);

  // members 테이블 업데이트
  await db.prepare(`UPDATE members SET phone = ? WHERE phone = ?`).bind(new_phone, phone).run();
  // applications 테이블도 업데이트
  await db.prepare(`UPDATE applications SET phone = ?, updated_at = ? WHERE phone = ?`)
    .bind(new_phone, new Date(Date.now() + 9*3600000).toISOString().replace('T',' ').slice(0,19), phone).run();

  return jsonResponse({ ok: true });
}

function maskRow(row) {
  const r = { ...row };
  delete r.ssn_encrypted;
  delete r.ssn_iv;
  // 앞 6자리 표시, 뒷 7자리 *
  r.ssn_masked = row.ssn_encrypted ? row.ssn_encrypted.slice(0, 2) + '??????-*******' : null;
  // ssn_iv에서 앞 6자리를 복원할 수 없으므로 마스킹 표기만
  r.ssn_masked = row.ssn_encrypted ? '??????-*******' : null;
  return r;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
