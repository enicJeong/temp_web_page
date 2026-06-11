// functions/api/[[route]].js
// Cloudflare Pages Functions

// ── 암호화 ───────────────────────────────────────────────
async function encryptSSN(ssn, secretKey) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' }, false, ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, keyMaterial, encoder.encode(ssn)
  );
  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv))
  };
}

async function decryptSSN(encryptedBase64, ivBase64, secretKey) {
  try {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secretKey.padEnd(32, '0').slice(0, 32)),
      { name: 'AES-GCM' }, false, ['decrypt']
    );
    const encrypted = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, keyMaterial, encrypted
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return '복호화오류';
  }
}

// ── Rate Limiting (D1 기반, IP당 1분 10회) ──────────────
async function checkRateLimit(env, ip) {
  const windowMs = 60; // 1분
  const maxRequests = 10;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowMs;

  // 1분 이내 해당 IP 조회 횟수
  const result = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM lookup_logs
     WHERE ip = ? AND looked_at >= datetime('now', '-1 minute', '+9 hours')`
  ).bind(ip).first();

  return (result?.cnt || 0) >= maxRequests;
}

// ── 공통 유틸 ────────────────────────────────────────────
function nowKST() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString()
    .replace('T', ' ').slice(0, 19);
}

function getAdminEmails(env) {
  const extra = (env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  return extra;
}

function isAdmin(email, env) {
  if (!email) return false;
  return getAdminEmails(env).includes(email.toLowerCase());
}

function getClientInfo(request) {
  return {
    ip: request.headers.get('CF-Connecting-IP') || 'unknown',
    country: request.headers.get('CF-IPCountry') || '',
    userAgent: request.headers.get('User-Agent') || '',
  };
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() }
  });
}

// ── 메인 핸들러 ──────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: cors() });
  }

  const { ip, country, userAgent } = getClientInfo(request);

  try {

    // ── 배당금 조회 (전화번호 + 생년월일) ─────────────────
    if (path === '/lookup' && request.method === 'POST') {
      const { phone, birthdate } = await request.json();

      if (!phone || !birthdate) {
        return json({ error: '전화번호와 생년월일을 모두 입력해주세요.' }, 400);
      }

      const normalizedPhone = phone.replace(/[^0-9]/g, '');
      const normalizedBirth = birthdate.replace(/[^0-9]/g, '');

      if (normalizedPhone.length < 10 || normalizedPhone.length > 11) {
        return json({ error: '올바른 전화번호를 입력해주세요.' }, 400);
      }
      if (normalizedBirth.length !== 8) {
        return json({ error: '생년월일 8자리를 입력해주세요. (예: 19901215)' }, 400);
      }

      // Rate limit 확인
      const limited = await checkRateLimit(env, ip);
      if (limited) {
        await env.DB.prepare(
          `INSERT INTO lookup_logs (phone, birthdate_tried, ip, country, user_agent, result)
           VALUES (?, ?, ?, ?, ?, 'rate_limited')`
        ).bind(normalizedPhone, normalizedBirth, ip, country, userAgent).run();
        return json({ error: '잠시 후 다시 시도해주세요. (1분에 10회 제한)' }, 429);
      }

      // 조회 — 전화번호 + 생년월일 동시 검증
      const member = await env.DB.prepare(
        `SELECT capital_dividend, usage_dividend, total_dividend,
                dividend_tax, local_tax, actual_amount
         FROM members
         WHERE REPLACE(phone, '-', '') = ?
           AND birthdate = ?`
      ).bind(normalizedPhone, normalizedBirth).first();

      const result = member ? 'found' : 'not_found';

      // 조회 로그 기록
      await env.DB.prepare(
        `INSERT INTO lookup_logs (phone, birthdate_tried, ip, country, user_agent, result)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(normalizedPhone, normalizedBirth, ip, country, userAgent, result).run();

      if (!member) {
        // 전번/생년월일 어느쪽이 틀렸는지 알려주지 않음
        return json({ error: '일치하는 정보가 없습니다.\n전화번호와 생년월일을 다시 확인해주세요.' }, 404);
      }

      // 기존 제출 여부 확인
      const existing = await env.DB.prepare(
        `SELECT payment_method, submitted_at FROM submissions
         WHERE REPLACE(phone, '-', '') = ?
         ORDER BY submitted_at DESC LIMIT 1`
      ).bind(normalizedPhone).first();

      return json({ success: true, member, existing: existing || null });
    }

    // ── 현금수령 신청 ──────────────────────────────────────
    if (path === '/submit/cash' && request.method === 'POST') {
      const { phone, birthdate, new_phone, name, bank_name, account_number,
              ssn, consent_personal, consent_unique_id, consent_third_party } = await request.json();

      if (!phone || !birthdate) return json({ error: '인증 정보가 없습니다.' }, 400);
      if (!name || !bank_name || !account_number || !ssn)
        return json({ error: '필수 항목을 모두 입력해주세요.' }, 400);
      if (!consent_personal || !consent_unique_id || !consent_third_party)
        return json({ error: '모든 동의 항목에 체크해주세요.' }, 400);

      const normalizedPhone = phone.replace(/[^0-9]/g, '');
      const normalizedBirth = birthdate.replace(/[^0-9]/g, '');

      // 제출 전 재인증
      const member = await env.DB.prepare(
        `SELECT id FROM members
         WHERE REPLACE(phone, '-', '') = ? AND birthdate = ?`
      ).bind(normalizedPhone, normalizedBirth).first();
      if (!member) return json({ error: '인증 정보가 유효하지 않습니다.' }, 403);

      const ssnClean = ssn.replace(/[^0-9]/g, '');
      if (ssnClean.length !== 13) return json({ error: '주민등록번호 13자리를 입력해주세요.' }, 400);

      const SECRET_KEY = env.ENCRYPTION_KEY || 'knsu-default-key-please-change!!';
      const { encrypted, iv } = await encryptSSN(ssnClean, SECRET_KEY);
      const now = nowKST();

      const existing = await env.DB.prepare(
        `SELECT id FROM submissions WHERE REPLACE(phone, '-', '') = ?`
      ).bind(normalizedPhone).first();

      if (existing) {
        await env.DB.prepare(`
          UPDATE submissions SET
            new_phone = ?, payment_method = 'cash',
            name = ?, bank_name = ?, account_number = ?,
            ssn_encrypted = ?, ssn_iv = ?,
            consent_personal = 1, consent_personal_at = ?,
            consent_unique_id = 1, consent_unique_id_at = ?,
            consent_third_party = 1, consent_third_party_at = ?,
            capital_reflected_at = NULL, updated_at = ?
          WHERE REPLACE(phone, '-', '') = ?
        `).bind(
          new_phone || null, name, bank_name, account_number,
          encrypted, iv, now, now, now, now, normalizedPhone
        ).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO submissions
            (phone, new_phone, payment_method, name, bank_name, account_number,
             ssn_encrypted, ssn_iv,
             consent_personal, consent_personal_at,
             consent_unique_id, consent_unique_id_at,
             consent_third_party, consent_third_party_at,
             submitted_at, updated_at)
          VALUES (?, ?, 'cash', ?, ?, ?, ?, ?, 1, ?, 1, ?, 1, ?, ?, ?)
        `).bind(
          phone, new_phone || null, name, bank_name, account_number,
          encrypted, iv, now, now, now, now, now
        ).run();
      }

      return json({ success: true, message: '현금수령 신청이 완료되었습니다.' });
    }

    // ── 출자금 반영 신청 ───────────────────────────────────
    if (path === '/submit/capital' && request.method === 'POST') {
      const { phone, birthdate, new_phone } = await request.json();

      if (!phone || !birthdate) return json({ error: '인증 정보가 없습니다.' }, 400);

      const normalizedPhone = phone.replace(/[^0-9]/g, '');
      const normalizedBirth = birthdate.replace(/[^0-9]/g, '');

      const member = await env.DB.prepare(
        `SELECT id FROM members
         WHERE REPLACE(phone, '-', '') = ? AND birthdate = ?`
      ).bind(normalizedPhone, normalizedBirth).first();
      if (!member) return json({ error: '인증 정보가 유효하지 않습니다.' }, 403);

      const now = nowKST();
      const existing = await env.DB.prepare(
        `SELECT id FROM submissions WHERE REPLACE(phone, '-', '') = ?`
      ).bind(normalizedPhone).first();

      if (existing) {
        await env.DB.prepare(`
          UPDATE submissions SET
            payment_method = 'capital', capital_reflected_at = ?,
            new_phone = ?, updated_at = ?,
            name = NULL, bank_name = NULL, account_number = NULL,
            ssn_encrypted = NULL, ssn_iv = NULL,
            consent_personal = 0, consent_personal_at = NULL,
            consent_unique_id = 0, consent_unique_id_at = NULL,
            consent_third_party = 0, consent_third_party_at = NULL
          WHERE REPLACE(phone, '-', '') = ?
        `).bind(now, new_phone || null, now, normalizedPhone).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO submissions (phone, new_phone, payment_method, capital_reflected_at, submitted_at, updated_at)
          VALUES (?, ?, 'capital', ?, ?, ?)
        `).bind(phone, new_phone || null, now, now, now).run();
      }

      return json({ success: true, message: '출자금 반영 신청이 완료되었습니다.' });
    }

    // ══════════════════════════════════════════════════════
    // 관리자 API
    // ══════════════════════════════════════════════════════

    if (path === '/admin/check' && request.method === 'GET') {
      const email = request.headers.get('Cf-Access-Authenticated-User-Email');
      if (!isAdmin(email, env)) return json({ authorized: false }, 403);
      return json({ authorized: true, email });
    }

    if (path === '/admin/list' && request.method === 'GET') {
      const email = request.headers.get('Cf-Access-Authenticated-User-Email');
      if (!isAdmin(email, env)) return json({ error: '권한이 없습니다.' }, 403);

      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const search = url.searchParams.get('search') || '';
      const pageSize = 50;
      const offset = (page - 1) * pageSize;
      const like = `%${search}%`;

      const [rows, countResult] = await Promise.all([
        env.DB.prepare(`
          SELECT m.phone, m.capital_dividend, m.usage_dividend, m.total_dividend,
                 m.dividend_tax, m.local_tax, m.actual_amount,
                 s.new_phone, s.payment_method, s.name, s.bank_name, s.account_number,
                 s.consent_personal, s.consent_personal_at,
                 s.consent_unique_id, s.consent_unique_id_at,
                 s.consent_third_party, s.consent_third_party_at,
                 s.capital_reflected_at, s.submitted_at
          FROM members m
          LEFT JOIN submissions s ON REPLACE(m.phone,'-','') = REPLACE(s.phone,'-','')
          WHERE m.phone LIKE ? OR s.name LIKE ?
          ORDER BY m.id LIMIT ? OFFSET ?
        `).bind(like, like, pageSize, offset).all(),
        env.DB.prepare(`
          SELECT COUNT(*) as cnt FROM members m
          LEFT JOIN submissions s ON REPLACE(m.phone,'-','') = REPLACE(s.phone,'-','')
          WHERE m.phone LIKE ? OR s.name LIKE ?
        `).bind(like, like).first()
      ]);

      const maskedRows = (rows.results || []).map(r => ({
        ...r,
        ssn_masked: r.payment_method === 'cash' ? '******-*******' : null,
      }));

      return json({
        rows: maskedRows,
        total: countResult?.cnt || 0,
        page,
        pageSize,
        totalPages: Math.ceil((countResult?.cnt || 0) / pageSize)
      });
    }

    // 관리자 통계
    if (path === '/admin/stats' && request.method === 'GET') {
      const email = request.headers.get('Cf-Access-Authenticated-User-Email');
      if (!isAdmin(email, env)) return json({ error: '권한이 없습니다.' }, 403);

      const [total, cash, capital] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) as cnt FROM members').first(),
        env.DB.prepare("SELECT COUNT(*) as cnt FROM submissions WHERE payment_method='cash'").first(),
        env.DB.prepare("SELECT COUNT(*) as cnt FROM submissions WHERE payment_method='capital'").first(),
      ]);

      const t = total?.cnt || 0;
      const c = cash?.cnt || 0;
      const k = capital?.cnt || 0;

      return json({ total: t, cash: c, capital: k, pending: t - c - k });
    }

    // 조회 로그 (관리자)
    if (path === '/admin/lookup-logs' && request.method === 'GET') {
      const email = request.headers.get('Cf-Access-Authenticated-User-Email');
      if (!isAdmin(email, env)) return json({ error: '권한이 없습니다.' }, 403);

      const search = url.searchParams.get('search') || '';
      const like = `%${search}%`;

      const logs = await env.DB.prepare(`
        SELECT phone, ip, country, user_agent, result, looked_at,
               COUNT(*) OVER (PARTITION BY ip) as ip_total_count,
               COUNT(*) OVER (PARTITION BY phone) as phone_total_count
        FROM lookup_logs
        WHERE phone LIKE ? OR ip LIKE ?
        ORDER BY looked_at DESC
        LIMIT 200
      `).bind(like, like).all();

      return json({ logs: logs.results || [] });
    }

    // 엑셀 다운로드
    if (path === '/admin/download' && request.method === 'GET') {
      const email = request.headers.get('Cf-Access-Authenticated-User-Email');
      if (!isAdmin(email, env)) return json({ error: '권한이 없습니다.' }, 403);

      const rows = await env.DB.prepare(`
        SELECT m.phone, m.capital_dividend, m.usage_dividend, m.total_dividend,
               m.dividend_tax, m.local_tax, m.actual_amount,
               s.new_phone, s.payment_method, s.name, s.bank_name, s.account_number,
               s.ssn_encrypted, s.ssn_iv,
               s.consent_personal, s.consent_personal_at,
               s.consent_unique_id, s.consent_unique_id_at,
               s.consent_third_party, s.consent_third_party_at,
               s.capital_reflected_at, s.submitted_at
        FROM members m
        LEFT JOIN submissions s ON REPLACE(m.phone,'-','') = REPLACE(s.phone,'-','')
        ORDER BY m.id
      `).all();

      const SECRET_KEY = env.ENCRYPTION_KEY || 'knsu-default-key-please-change!!';
      const decryptedRows = await Promise.all((rows.results || []).map(async r => {
        let ssn = '';
        if (r.ssn_encrypted && r.ssn_iv) {
          ssn = await decryptSSN(r.ssn_encrypted, r.ssn_iv, SECRET_KEY);
        }
        const { ssn_encrypted, ssn_iv, ...rest } = r;
        return { ...rest, ssn };
      }));

      const now = nowKST();
      await env.DB.prepare(
        'INSERT INTO download_logs (admin_email, downloaded_at, row_count) VALUES (?, ?, ?)'
      ).bind(email, now, decryptedRows.length).run();

      return json({ rows: decryptedRows, downloaded_at: now });
    }

    // 다운로드 로그
    if (path === '/admin/download-logs' && request.method === 'GET') {
      const email = request.headers.get('Cf-Access-Authenticated-User-Email');
      if (!isAdmin(email, env)) return json({ error: '권한이 없습니다.' }, 403);

      const logs = await env.DB.prepare(
        'SELECT * FROM download_logs ORDER BY downloaded_at DESC LIMIT 50'
      ).all();
      return json({ logs: logs.results || [] });
    }

    // 회원 데이터 업로드
    if (path === '/admin/upload-members' && request.method === 'POST') {
      const email = request.headers.get('Cf-Access-Authenticated-User-Email');
      if (!isAdmin(email, env)) return json({ error: '권한이 없습니다.' }, 403);

      const { members } = await request.json();
      if (!Array.isArray(members)) return json({ error: '배열 형식이어야 합니다.' }, 400);

      let inserted = 0, updated = 0, errors = [];

      for (const m of members) {
        if (!m.phone || !m.birthdate) {
          errors.push(`phone/birthdate 누락: ${JSON.stringify(m)}`);
          continue;
        }
        const normalizedPhone = m.phone.replace(/[^0-9]/g, '');
        const normalizedBirth = m.birthdate.replace(/[^0-9]/g, '');

        const existing = await env.DB.prepare(
          `SELECT id FROM members WHERE REPLACE(phone,'-','') = ?`
        ).bind(normalizedPhone).first();

        if (existing) {
          await env.DB.prepare(`
            UPDATE members SET
              birthdate=?, capital_dividend=?, usage_dividend=?,
              total_dividend=?, dividend_tax=?, local_tax=?, actual_amount=?
            WHERE id=?
          `).bind(
            normalizedBirth,
            m.capital_dividend||0, m.usage_dividend||0, m.total_dividend||0,
            m.dividend_tax||0, m.local_tax||0, m.actual_amount||0,
            existing.id
          ).run();
          updated++;
        } else {
          await env.DB.prepare(`
            INSERT INTO members
              (phone, birthdate, capital_dividend, usage_dividend, total_dividend,
               dividend_tax, local_tax, actual_amount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            normalizedPhone, normalizedBirth,
            m.capital_dividend||0, m.usage_dividend||0, m.total_dividend||0,
            m.dividend_tax||0, m.local_tax||0, m.actual_amount||0
          ).run();
          inserted++;
        }
      }

      return json({ success: true, inserted, updated, errors });
    }

    return json({ error: 'Not found' }, 404);

  } catch (err) {
    console.error(err);
    return json({ error: '서버 오류가 발생했습니다.', detail: err.message }, 500);
  }
}
