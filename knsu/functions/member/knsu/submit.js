// functions/member/knsu/submit.js
// POST /member/knsu/submit
// 수령방법 신청 — 서버에서 재인증 후 저장
// 재신청 시 기존 내용 덮어씌움

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
  const method = body.method; // 'cash' | 'capital'

  if (!phone || !name) {
    return jsonResponse({ ok: false, error: '전화번호와 이름을 입력해주세요.' }, 400);
  }
  if (!['cash', 'capital'].includes(method)) {
    return jsonResponse({ ok: false, error: '수령 방법을 선택해주세요.' }, 400);
  }

  // 서버 재인증
  const member = await db
    .prepare(`SELECT name FROM members WHERE phone = ?`)
    .bind(phone)
    .first();

  if (!member || member.name !== name) {
    await db
      .prepare(`INSERT INTO lookup_logs (ip, phone, result) VALUES (?, ?, 'mismatch')`)
      .bind(ip, phone)
      .run();
    return jsonResponse({ ok: false, error: '일치하는 정보가 없습니다.' }, 403);
  }

  const now = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
  const phoneChanged = normalizePhone(body.phone_changed ?? '') || null;

  if (method === 'capital') {
    // 출자금 반영
    await db
      .prepare(
        `INSERT INTO applications (phone, method, phone_changed, capital_at, applied_at, updated_at)
         VALUES (?, 'capital', ?, ?, ?, ?)
         ON CONFLICT(phone) DO UPDATE SET
           method = 'capital',
           applicant_name = NULL,
           bank = NULL,
           account = NULL,
           ssn_encrypted = NULL,
           ssn_iv = NULL,
           consent1_at = NULL,
           consent2_at = NULL,
           consent3_at = NULL,
           phone_changed = excluded.phone_changed,
           capital_at = excluded.capital_at,
           updated_at = excluded.updated_at`
      )
      .bind(phone, phoneChanged, now, now, now)
      .run();

    return jsonResponse({ ok: true, method: 'capital' });
  }

  // 현금수령 — 입력값 검증
  const applicantName = (body.applicant_name ?? '').trim();
  const bank = (body.bank ?? '').trim();
  const account = (body.account ?? '').trim();
  const ssn = (body.ssn ?? '').replace(/\D/g, '');
  const consent1At = body.consent1_at ?? null;
  const consent2At = body.consent2_at ?? null;
  const consent3At = body.consent3_at ?? null;

  if (!applicantName || !bank || !account) {
    return jsonResponse({ ok: false, error: '이름, 은행명, 계좌번호를 모두 입력해주세요.' }, 400);
  }
  if (ssn.length !== 13) {
    return jsonResponse({ ok: false, error: '주민등록번호를 올바르게 입력해주세요.' }, 400);
  }
  if (!consent1At || !consent2At || !consent3At) {
    return jsonResponse({ ok: false, error: '필수 동의 항목을 모두 체크해주세요.' }, 400);
  }

  // 주민번호 AES-256-GCM 암호화
  let ssnEncrypted, ssnIv;
  try {
    const { encrypted, iv } = await encryptSSN(ssn, env.ENCRYPTION_KEY);
    ssnEncrypted = encrypted;
    ssnIv = iv;
  } catch (e) {
    console.error('SSN encryption failed:', e);
    return jsonResponse({ ok: false, error: '서버 오류가 발생했습니다.' }, 500);
  }

  await db
    .prepare(
      `INSERT INTO applications
         (phone, method, applicant_name, bank, account,
          ssn_encrypted, ssn_iv,
          consent1_at, consent2_at, consent3_at,
          phone_changed, capital_at, applied_at, updated_at)
       VALUES (?, 'cash', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET
         method = 'cash',
         applicant_name = excluded.applicant_name,
         bank = excluded.bank,
         account = excluded.account,
         ssn_encrypted = excluded.ssn_encrypted,
         ssn_iv = excluded.ssn_iv,
         consent1_at = excluded.consent1_at,
         consent2_at = excluded.consent2_at,
         consent3_at = excluded.consent3_at,
         phone_changed = excluded.phone_changed,
         capital_at = NULL,
         updated_at = excluded.updated_at`
    )
    .bind(
      phone, applicantName, bank, account,
      ssnEncrypted, ssnIv,
      consent1At, consent2At, consent3At,
      phoneChanged, now, now
    )
    .run();

  return jsonResponse({ ok: true, method: 'cash' });
}

// ─── AES-256-GCM 암호화 ───────────────────────────────────────────
async function encryptSSN(plaintext, keyBase64) {
  const keyBytes = base64ToBytes(keyBase64);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, cryptoKey, encoded
  );
  return {
    encrypted: bytesToBase64(new Uint8Array(cipherBuf)),
    iv: bytesToBase64(iv),
  };
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
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
