// functions/knsu/lookup.js
// POST /knsu/lookup
// Body: { phone: string, name: string }
// 본인확인 후 배당금 내역 + 기존 신청 여부 반환

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

  // 회원 조회
  const member = await db
    .prepare(`SELECT * FROM members WHERE phone = ?`)
    .bind(phone)
    .first();

  // 이름 불일치 또는 미존재 — 동일 오류 메시지
  if (!member || member.name !== name) {
    await db
      .prepare(`INSERT INTO lookup_logs (ip, phone, result) VALUES (?, ?, 'mismatch')`)
      .bind(ip, phone)
      .run();
    return jsonResponse({ ok: false, error: '일치하는 정보가 없습니다.' }, 404);
  }

  // 성공 로그
  await db
    .prepare(`INSERT INTO lookup_logs (ip, phone, result) VALUES (?, ?, 'success')`)
    .bind(ip, phone)
    .run();

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

// 전화번호 정규화: 숫자만 추출
function normalizePhone(raw) {
  return raw.replace(/\D/g, '');
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
