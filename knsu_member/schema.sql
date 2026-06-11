-- 배당금 기본 데이터 테이블
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,           -- 전화번호 (숫자만, 010xxxxxxxx)
  birthdate TEXT NOT NULL,              -- 생년월일 8자리 (19901215)
  capital_dividend INTEGER DEFAULT 0,   -- 출자배당
  usage_dividend INTEGER DEFAULT 0,     -- 사용실적배당
  total_dividend INTEGER DEFAULT 0,     -- 배당총액
  dividend_tax INTEGER DEFAULT 0,       -- 배당소득세
  local_tax INTEGER DEFAULT 0,          -- 지방소득세
  actual_amount INTEGER DEFAULT 0,      -- 실제수령액
  created_at TEXT DEFAULT (datetime('now', '+9 hours'))
);

-- 이용자 제출 데이터 테이블
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  new_phone TEXT,
  payment_method TEXT NOT NULL,         -- 'cash' | 'capital'
  name TEXT,
  bank_name TEXT,
  account_number TEXT,
  ssn_encrypted TEXT,
  ssn_iv TEXT,
  consent_personal INTEGER DEFAULT 0,
  consent_personal_at TEXT,
  consent_unique_id INTEGER DEFAULT 0,
  consent_unique_id_at TEXT,
  consent_third_party INTEGER DEFAULT 0,
  consent_third_party_at TEXT,
  capital_reflected_at TEXT,
  submitted_at TEXT DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+9 hours'))
);

-- 조회 로그 테이블 (IP 추적)
CREATE TABLE IF NOT EXISTS lookup_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  birthdate_tried TEXT,                 -- 입력한 생년월일
  ip TEXT,
  country TEXT,
  user_agent TEXT,
  result TEXT,                          -- 'found' | 'not_found' | 'rate_limited'
  looked_at TEXT DEFAULT (datetime('now', '+9 hours'))
);

-- 관리자 다운로드 로그
CREATE TABLE IF NOT EXISTS download_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_email TEXT NOT NULL,
  downloaded_at TEXT DEFAULT (datetime('now', '+9 hours')),
  row_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);
CREATE INDEX IF NOT EXISTS idx_submissions_phone ON submissions(phone);
CREATE INDEX IF NOT EXISTS idx_lookup_logs_phone ON lookup_logs(phone);
CREATE INDEX IF NOT EXISTS idx_lookup_logs_ip ON lookup_logs(ip);
