// functions/member/admin/knsu/members.js
// GET /member/admin/knsu/members?page=1&search=홍길동
// 신청 목록 조회 — 50명 페이지네이션, 이름/전화번호 검색, 주민번호 마스킹

const PAGE_SIZE = 50;

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const search = (url.searchParams.get('search') ?? '').trim();
  const offset = (page - 1) * PAGE_SIZE;

  let countQuery, listQuery, params;

  if (search) {
    const like = `%${search}%`;
    countQuery = `
      SELECT COUNT(*) as cnt
      FROM members m
      LEFT JOIN applications a ON m.phone = a.phone
      WHERE m.name LIKE ? OR m.phone LIKE ?
    `;
    listQuery = `
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
      WHERE m.name LIKE ? OR m.phone LIKE ?
      ORDER BY m.phone
      LIMIT ? OFFSET ?
    `;
    params = [like, like];
  } else {
    countQuery = `
      SELECT COUNT(*) as cnt FROM members
    `;
    listQuery = `
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
      ORDER BY m.phone
      LIMIT ? OFFSET ?
    `;
    params = [];
  }

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

// 주민번호 마스킹: 000000-******* 형식
function maskRow(row) {
  const masked = { ...row };
  delete masked.ssn_encrypted;
  delete masked.ssn_iv;
  // 암호화 데이터가 있으면 마스킹 표시
  masked.ssn_masked = row.ssn_encrypted ? '******-*******' : null;
  return masked;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
