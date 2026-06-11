// functions/member/admin/knsu/download.js
// GET /member/admin/knsu/download
// 전체 데이터 JSON 반환 (주민번호 복호화 포함)
// 프론트엔드에서 SheetJS로 xlsx 생성
// 다운로드마다 로그 자동 기록

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;
  const adminEmail = context.data.adminEmail;

  const { results } = await db
    .prepare(
      `SELECT
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
       ORDER BY m.phone`
    )
    .all();

  const rows = results ?? [];

  // 주민번호 복호화
  const decryptedRows = await Promise.all(
    rows.map(async (row) => {
      const r = { ...row };
      if (row.ssn_encrypted && row.ssn_iv) {
        try {
          r.ssn = await decryptSSN(row.ssn_encrypted, row.ssn_iv, env.ENCRYPTION_KEY);
        } catch {
          r.ssn = '복호화 오류';
        }
      } else {
        r.ssn = null;
      }
      delete r.ssn_encrypted;
      delete r.ssn_iv;
      return r;
    })
  );

  // 다운로드 로그 기록
  await db
    .prepare(
      `INSERT INTO download_logs (email, row_count) VALUES (?, ?)`
    )
    .bind(adminEmail, rows.length)
    .run();

  return jsonResponse({ ok: true, rows: decryptedRows });
}

// ─── AES-256-GCM 복호화 ───────────────────────────────────────────
async function decryptSSN(encryptedBase64, ivBase64, keyBase64) {
  const keyBytes = base64ToBytes(keyBase64);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
  );
  const iv = base64ToBytes(ivBase64);
  const cipherBytes = base64ToBytes(encryptedBase64);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, cryptoKey, cipherBytes
  );
  return new TextDecoder().decode(plainBuf);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
