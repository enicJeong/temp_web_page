# KNSU 배당금 시스템 배포 가이드

배포 환경: Cloudflare Pages + Pages Functions + D1
CLI(wrangler) 없이 대시보드에서만 설정합니다.

---

## 파일 구조

```
knsu/
├── public/
│   ├── index.html          ← 사용자 화면
│   ├── admin.html          ← 관리자 화면
│   └── _redirects          ← 경로 라우팅
├── functions/member/
│   ├── knsu/
│   │   ├── _middleware.js  ← Rate limiting
│   │   ├── lookup.js       ← 본인확인 API
│   │   └── submit.js       ← 신청 API
│   └── admin/knsu/
│       ├── _middleware.js  ← 관리자 인증
│       ├── stats.js
│       ├── members.js
│       ├── logs.js
│       ├── download.js
│       └── upload.js
└── schema.sql              ← D1 테이블 정의
```

---

## 1단계: GitHub 레포 준비

temp/ (main 브랜치)
├── donga/   ← 기존 프로젝트 (건드리지 않음)
└── knsu/    ← 이 폴더 전체 추가 후 push

---

## 2단계: D1 데이터베이스 생성 및 스키마 적용

1. Cloudflare Dashboard → Storage & Databases → D1 SQL Database → Create
2. Database name: uneedcoop-member-db → Create 클릭
3. 생성된 DB 클릭 → Console 탭
4. schema.sql 내용 전체 붙여넣기 → Execute
5. Tables 탭에서 members / applications / lookup_logs / download_logs 4개 확인

---

## 3단계: Pages 프로젝트 생성

Workers & Pages → Create → Pages → Connect to Git

- Repository: temp
- Branch: main
- Framework preset: None
- Build command: (비움)
- Build output directory: public
- Root directory: knsu

Save and Deploy 클릭

---

## 4단계: D1 바인딩 연결

Pages 프로젝트 → Settings → Bindings → Add → D1 database

Variable name: DB
D1 database: uneedcoop-member-db

저장 후 → Deployments → 최근 배포 → Retry deployment

---

## 5단계: 환경변수 등록

Pages 프로젝트 → Settings → Environment variables → Production → Add variables

변수명: ENCRYPTION_KEY
값: (아래 방법으로 생성)

변수명: ADMIN_EMAILS
값: admin@example.com (여러 명이면 콤마 구분)

### ENCRYPTION_KEY 생성 (브라우저 콘솔 F12에서 한 번만 실행)

const key = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
);
const raw = await crypto.subtle.exportKey('raw', key);
console.log(btoa(String.fromCharCode(...new Uint8Array(raw))));

출력된 값을 ENCRYPTION_KEY에 등록.
⚠️ 이 값은 따로 보관하고 절대 변경 금지 (변경 시 기존 주민번호 복호화 불가)

환경변수 저장 후 다시 Retry deployment

---

## 6단계: Cloudflare Access 설정 (관리자 페이지 보호)

Zero Trust → Access → Applications → Add an application → Self-hosted

- Application name: KNSU Admin
- Application domain: uneedcoop.com
- Path: member/admin/knsu
- Identity providers: One-time PIN (이메일 OTP)

Policy:
- Policy name: Admin only
- Action: Allow
- Include rule: Emails → 관리자 이메일 입력

---

## 7단계: 커스텀 도메인 연결

Pages 프로젝트 → Custom domains → Set up a custom domain
→ uneedcoop.com 입력 (Cloudflare DNS 자동 연결)

---

## 8단계: 회원 데이터 업로드

관리자 페이지(uneedcoop.com/member/admin/knsu) → 데이터 업로드 탭

아래 형식 JSON 붙여넣기 후 업로드:

[
  {
    "phone": "01012345678",
    "name": "홍길동",
    "div_capital": 5000,
    "div_usage": 12000,
    "div_total": 17000,
    "tax_income": 0,
    "tax_local": 0,
    "div_net": 17000
  }
]
