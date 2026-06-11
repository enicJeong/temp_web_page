// functions/knsu/lookup.js
// POST /knsu/lookup

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: '잘못된 요청입니다.' }, 400);
  }

  const phone = normalizePhone(body.phone ?? '');
  const name = (body.name ?? '').trim();

  if (!phone || !name) {
    return jsonResponse({ ok: false, error: '전화번호와 이름을 모두 입력해주세요.' }, 400);
  }

  const kstNow = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);

  // 회원 조회
  const member = await db
    .prepare(`SELECT * FROM members WHERE phone = ?`)
    .bind(phone)
    .first();

  // 이름 불일치 또는 미존재
  if (!member || member.name !== name) {
    // 로그 비동기 처리 (응답 속도에 영향 없음)
    context.waitUntil(
      db.prepare(`INSERT INTO lookup_logs (ip, phone, result, logged_at) VALUES (?, ?, 'mismatch', ?)`)
        .bind(ip, phone, kstNow()).run()
    );
    return jsonResponse({ ok: false, error: '일치하는 정보가 없습니다.' }, 404);
  }

  // 성공 로그 비동기 처리
  context.waitUntil(
    db.prepare(`INSERT INTO lookup_logs (ip, phone, result, logged_at) VALUES (?, ?, 'success', ?)`)
      .bind(ip, phone, kstNow()).run()
  );

  // 기존 신청 여부 확인
  const existing = await db
    .prepare(`SELECT method, applied_at FROM applications WHERE phone = ?`)
    .bind(phone)
    .first();

  return jsonResponse({
    ok: true,
    member: {
      phone: member.phone,
      name: member.name,
      div_capital: member.div_capital,
      div_usage: member.div_usage,
      div_total: member.div_total,
      tax_income: member.tax_income,
      tax_local: member.tax_local,
      div_net: member.div_net,
    },
    existing: existing
      ? { method: existing.method, applied_at: existing.applied_at }
      : null,
  });
}

function normalizePhone(raw) {
  return raw.replace(/\D/g, '');
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
