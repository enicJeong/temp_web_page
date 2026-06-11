// functions/member/admin/knsu/download.js
// GET /member/admin/knsu/download

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;
  const adminEmail = context.data.adminEmail ?? 'unknown';

  try {
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

    // 주민번호 복호화 (ENCRYPTION_KEY 없으면 null 처리)
    const encKey = env.ENCRYPTION_KEY ?? null;
    const decryptedRows = await Promise.all(
      rows.map(async (row) => {
        const r = { ...row };
        if (row.ssn_encrypted && row.ssn_iv && encKey) {
          try {
            r.ssn = await decryptSSN(row.ssn_encrypted, row.ssn_iv, encKey);
          } catch (e) {
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
    try {
      const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';
      const kstNow = new Date(Date.now() + 9*3600000).toISOString().replace('T',' ').substring(0,19);
      await db
        .prepare(`INSERT INTO download_logs (email, ip, row_count, downloaded_at) VALUES (?, ?, ?, ?)`)
        .bind(adminEmail, ip, rows.length, kstNow)
        .run();
    } catch (e) {
      console.error('download log insert failed:', e);
    }

    return jsonResponse({ ok: true, rows: decryptedRows });

  } catch (e) {
    console.error('download error:', e);
    return jsonResponse({ ok: false, error: String(e?.message ?? e) }, 500);
  }
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
