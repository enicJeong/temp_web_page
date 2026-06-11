# KNSU 배당금 시스템 배포 가이드

배포 환경: Cloudflare Pages + Pages Functions + D1

---

## 1단계: GitHub 레포 준비

```
temp/ (main 브랜치)
├── donga/        ← 기존 프로젝트 (건드리지 않음)
└── knsu/         ← 이 프로젝트 전체를 여기에 추가
```

`knsu/` 폴더를 main 브랜치에 push합니다.

---

## 2단계: D1 데이터베이스 생성

로컬에서 wrangler CLI로 실행합니다.

```bash
# wrangler 설치 (없는 경우)
npm install -g wrangler

# Cloudflare 로그인
wrangler login

# D1 데이터베이스 생성
wrangler d1 create uneedcoop-member-db
```

출력된 `database_id` 값을 `wrangler.toml`의 `database_id`에 붙여넣습니다.

```bash
# 스키마 적용
wrangler d1 execute uneedcoop-member-db --file=knsu/schema.sql
```

---

## 3단계: Cloudflare Pages 프로젝트 생성

Cloudflare Dashboard → Pages → "Create a project" → "Connect to Git"

설정:
- Repository: temp (GitHub 레포)
- Branch: main
- **Build settings**
  - Framework preset: None
  - Build command: (비움)
  - Build output directory: `knsu/public`
  - Root directory: `knsu`

> ⚠️ Root directory를 `knsu`로 지정해야 `functions/` 폴더가 올바르게 인식됩니다.

---

## 4단계: D1 바인딩 연결

Pages 프로젝트 → Settings → Functions → D1 database bindings

| Variable name | D1 database           |
|---------------|-----------------------|
| DB            | uneedcoop-member-db   |

---

## 5단계: 환경변수 등록

Pages 프로젝트 → Settings → Environment variables → Production

| 변수명            | 값                                    | 설명                            |
|-------------------|---------------------------------------|---------------------------------|
| ENCRYPTION_KEY    | (32바이트 base64 문자열)              | 주민번호 AES-256-GCM 암호화 키  |
| ADMIN_EMAILS      | admin@example.com,admin2@example.com  | 콤마 구분 관리자 이메일 목록    |

### ENCRYPTION_KEY 생성 방법

브라우저 콘솔 또는 Node.js에서 한 번만 실행:

```javascript
// 브라우저 콘솔
const key = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
);
const raw = await crypto.subtle.exportKey('raw', key);
const b64 = btoa(String.fromCharCode(...new Uint8Array(raw)));
console.log(b64);
```

생성된 값을 `ENCRYPTION_KEY`에 등록합니다.
⚠️ **이 값은 절대 변경하지 마세요.** 변경하면 기존 주민번호 복호화 불가.

---

## 6단계: Cloudflare Access 설정 (관리자 보호)

Cloudflare Zero Trust → Access → Applications → "Add an application"

- Application type: Self-hosted
- Application name: KNSU Admin
- Application domain: `uneedcoop.com/member/admin/knsu*`
- Identity providers: One-time PIN (이메일 OTP) 또는 Google

Policy:
- Action: Allow
- Rule: Emails — 관리자 이메일 목록 직접 입력

> 이 설정이 되어야 `Cf-Access-Authenticated-User-Email` 헤더가 Workers에 전달됩니다.

---

## 7단계: 커스텀 도메인 라우팅

Pages 프로젝트 → Custom domains → `uneedcoop.com` 연결

Cloudflare Dashboard → Pages에서 path 기반 라우팅은 Pages 자체에서 처리됩니다.
`uneedcoop.com/member/knsu` → `knsu/public/index.html`
`uneedcoop.com/member/admin/knsu` → `knsu/public/admin.html`

**관리자 페이지 리다이렉트를 위해 `public/_redirects` 파일 추가:**

```
/member/knsu  /index.html  200
/member/admin/knsu  /admin.html  200
/member/admin/knsu/*  /admin.html  200
```

---

## 8단계: 회원 데이터 업로드

관리자 페이지(`/member/admin/knsu`) → "데이터 업로드" 탭에서
아래 형식의 JSON을 붙여넣고 업로드:

```json
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
```

---

## 로컬 개발 (선택)

```bash
cd knsu
wrangler pages dev public --d1=DB=uneedcoop-member-db
```

`localhost:8788/member/knsu`에서 확인 가능.
단, Cloudflare Access 헤더가 없으므로 관리자 페이지는 로컬 테스트 불가.
관리자 테스트 시 `_middleware.js`의 이메일 검증을 임시 우회하거나 별도 테스트 환경 사용.

---

## 파일 구조 요약

```
knsu/
├── public/
│   ├── index.html          ← 사용자 화면 (본인확인 + 배당금 조회 + 신청)
│   ├── admin.html          ← 관리자 화면
│   └── _redirects          ← 경로 라우팅 (직접 생성 필요, 위 내용 참고)
├── functions/
│   └── member/
│       ├── knsu/
│       │   ├── _middleware.js   ← Rate limiting (1분 10회)
│       │   ├── lookup.js        ← POST /member/knsu/lookup
│       │   └── submit.js        ← POST /member/knsu/submit
│       └── admin/
│           └── knsu/
│               ├── _middleware.js   ← Cloudflare Access 이중 검증
│               ├── stats.js         ← GET /member/admin/knsu/stats
│               ├── members.js       ← GET /member/admin/knsu/members
│               ├── logs.js          ← GET /member/admin/knsu/logs
│               ├── download.js      ← GET /member/admin/knsu/download
│               └── upload.js        ← POST /member/admin/knsu/upload
├── schema.sql
└── wrangler.toml
```
