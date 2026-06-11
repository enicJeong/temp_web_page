-- =====================================================
-- KNSU 배당금 조회 시스템 D1 스키마
-- Cloudflare D1 (SQLite)
-- =====================================================

-- 회원 + 배당금 기준 데이터
CREATE TABLE IF NOT EXISTS members (
  phone       TEXT PRIMARY KEY,   -- 정규화된 전화번호 (숫자만)
  name        TEXT NOT NULL,
  div_capital INTEGER NOT NULL DEFAULT 0,  -- 출자배당금 (원)
  div_usage   INTEGER NOT NULL DEFAULT 0,  -- 사용실적배당금 (원)
  div_total   INTEGER NOT NULL DEFAULT 0,  -- 배당총액
  tax_income  INTEGER NOT NULL DEFAULT 0,  -- 배당소득세
  tax_local   INTEGER NOT NULL DEFAULT 0,  -- 지방소득세
  div_net     INTEGER NOT NULL DEFAULT 0   -- 실제수령액
);

-- 신청 결과
CREATE TABLE IF NOT EXISTS applications (
  phone           TEXT PRIMARY KEY,
  method          TEXT NOT NULL CHECK(method IN ('cash','capital')),
  -- 현금수령 시 입력 항목
  applicant_name  TEXT,
  bank            TEXT,
  account         TEXT,
  ssn_encrypted   TEXT,   -- AES-256-GCM 암호화 (base64)
  ssn_iv          TEXT,   -- IV (base64)
  consent1_at     TEXT,   -- 개인정보 수집·이용 동의 시각
  consent2_at     TEXT,   -- 고유식별정보 수집·이용 동의 시각
  consent3_at     TEXT,   -- 제3자 제공 동의 시각
  -- 공통
  phone_changed   TEXT,   -- 변경 전화번호 (선택입력)
  capital_at      TEXT,   -- 출자반영 선택 시각
  applied_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT
);

-- 조회 로그 (Rate limiting + 관리자 모니터링)
CREATE TABLE IF NOT EXISTS lookup_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ip          TEXT NOT NULL,
  phone       TEXT,
  result      TEXT NOT NULL CHECK(result IN ('success','mismatch','rate_limited')),
  logged_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_lookup_logs_ip_time ON lookup_logs(ip, logged_at);
CREATE INDEX IF NOT EXISTS idx_lookup_logs_logged_at ON lookup_logs(logged_at);

-- 다운로드 로그
CREATE TABLE IF NOT EXISTS download_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL,
  row_count     INTEGER NOT NULL,
  downloaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
