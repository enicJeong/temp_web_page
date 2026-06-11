// functions/admin/knsu/members.js
// GET /admin/knsu/members?page=1&search=홍길동&method=cash|capital|pending

const PAGE_SIZE = 50;

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const search = (url.searchParams.get('search') ?? '').trim();
  const method = (url.searchParams.get('method') ?? '').trim(); // cash | capital | pending | ''
  const offset = (page - 1) * PAGE_SIZE;

  // WHERE 조건 동적 생성
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(m.name LIKE ? OR m.phone LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like);
  }

  if (method === 'cash') {
    conditions.push("a.method = 'cash'");
  } else if (method === 'capital') {
    conditions.push("a.method = 'capital'");
  } else if (method === 'pending') {
    conditions.push('a.method IS NULL');
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const countQuery = `
    SELECT COUNT(*) as cnt
    FROM members m
    LEFT JOIN applications a ON m.phone = a.phone
    ${where}
  `;

  const listQuery = `
    SELECT
      m.phone, m.name,
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
    ORDER BY a.applied_at DESC, m.phone ASC
    LIMIT ? OFFSET ?
  `;

  const [countResult, listResult] = await Promise.all([
    db.prepare(countQuery).bind(...params).first(),
    db.prepare(listQuery).bind(...params, PAGE_SIZE, offset).all(),
  ]);

  const total = countResult?.cnt ?? 0;
  const rows = (listResult.results ?? []).map(maskRow);

  return jsonResponse({
    ok: true,
    total,
    page,
    page_size: PAGE_SIZE,
    total_pages: Math.ceil(total / PAGE_SIZE),
    rows,
  });
}

function maskRow(row) {
  const masked = { ...row };
  delete masked.ssn_encrypted;
  delete masked.ssn_iv;
  masked.ssn_masked = row.ssn_encrypted ? '******-*******' : null;
  return masked;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
