// functions/member/admin/knsu/upload.js
// POST /member/admin/knsu/upload
// Body: { members: Array<MemberRow> }
// 기존 전화번호는 UPDATE, 신규는 INSERT

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: '잘못된 JSON 형식입니다.' }, 400);
  }

  const members = body.members;
  if (!Array.isArray(members) || members.length === 0) {
    return jsonResponse({ ok: false, error: 'members 배열이 필요합니다.' }, 400);
  }

  // 입력값 검증
  const required = ['phone', 'name', 'div_capital', 'div_usage', 'div_total', 'tax_income', 'tax_local', 'div_net'];
  for (const [i, m] of members.entries()) {
    for (const field of required) {
      if (m[field] === undefined || m[field] === null) {
        return jsonResponse(
          { ok: false, error: `항목 ${i + 1}: '${field}' 필드가 없습니다.` },
          400
        );
      }
    }
  }

  // D1 배치 처리 (최대 한 번에 100건씩)
  const BATCH_SIZE = 100;
  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < members.length; i += BATCH_SIZE) {
    const batch = members.slice(i, i + BATCH_SIZE);
    const stmts = batch.map((m) => {
      const phone = String(m.phone).replace(/\D/g, '');
      return db.prepare(
        `INSERT INTO members (phone, name, div_capital, div_usage, div_total, tax_income, tax_local, div_net)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(phone) DO UPDATE SET
           name = excluded.name,
           div_capital = excluded.div_capital,
           div_usage = excluded.div_usage,
           div_total = excluded.div_total,
           tax_income = excluded.tax_income,
           tax_local = excluded.tax_local,
           div_net = excluded.div_net`
      ).bind(
        phone,
        String(m.name).trim(),
        parseInt(m.div_capital, 10),
        parseInt(m.div_usage, 10),
        parseInt(m.div_total, 10),
        parseInt(m.tax_income, 10),
        parseInt(m.tax_local, 10),
        parseInt(m.div_net, 10)
      );
    });

    await db.batch(stmts);
    inserted += batch.length; // ON CONFLICT 포함한 처리 수
  }

  return jsonResponse({
    ok: true,
    processed: members.length,
    message: `${members.length}건 처리 완료 (신규 추가 또는 업데이트)`,
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
