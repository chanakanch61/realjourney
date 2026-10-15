# Vercel Get Link (Next.js App Router)

## Formosa API

ตัวกลางฝั่ง server สำหรับให้ PHP production เรียก Formosa ผ่าน host ของ Next.js
ใช้ Node.js 22+ และ Next.js App Router เดิม ไม่มี credential ส่งไป browser
API contract อยู่ใน [docs/formosa.openapi.json](docs/formosa.openapi.json)

### ตั้งค่าบนเครื่อง local

```powershell
npm install
Copy-Item .env.example .env.local
# แก้ .env.local ด้วย editor: ใส่ cookie จากบัญชี agent และ shared secret ของคุณ
npm run dev
```

Environment variables ฝั่ง Next.js:

| ตัวแปร | ค่า |
| --- | --- |
| `FORMOSA_COOKIE` | ค่า Cookie request header จากบัญชี agent ที่ล็อกอินอยู่ ไม่มีคำว่า `Cookie:` นำหน้า |
| `FORMOSA_PROXY_TOKEN` | secret สุ่มยาวที่ตรงกับ PHP ใช้อักขระ ASCII ไม่มี whitespace |

`FORMOSA_PROXY_TOKEN` สร้างเองสำหรับยืนยันตัวตนระหว่าง PHP กับ Next.js ไม่ใช่ token ที่ต้องขอจาก Formosa
ส่วน nonce ไม่ต้องตั้งใน environment เพราะระบบอ่านใหม่จากหน้า agent และ refresh เมื่อจำเป็น

`.env.example` มีเฉพาะ placeholder ส่วน `.env.local` ถูก ignore แล้ว
ห้ามใช้ชื่อ `NEXT_PUBLIC_...`, ฝังใน source หรือ `next.config.js`, เปิดเผยผ่าน browser หรือ log
รีสตาร์ต process หลังเปลี่ยน environment; cookie เดิมที่เคยฝังใน source ควรเปลี่ยน session ใหม่

### Endpoint และพฤติกรรม

`GET /api/formosa` ต้องส่ง `Authorization: Bearer <FORMOSA_PROXY_TOKEN>`
token ตรวจด้วย `timingSafeEqual` บน SHA-256 digest ที่ยาวเท่ากัน ก่อนเรียก upstream

| Query | ผลลัพธ์ |
| --- | --- |
| ไม่ระบุ | ทุกประเทศ ทุกหน้า รวมและไม่ซ้ำ `mainid` |
| `?country=7` | ญี่ปุ่นทุกหน้า |
| `?country=7&page=1` | ญี่ปุ่นเฉพาะหน้าที่ 1 |

รองรับ ID: china=6, America & Cannada=27, Europe=28, Georgia=15, Japan=7,
Myanmar=13, Russia=25, Singapore=14, Taiwan=10, Vietnam=12, Macao=219,
Hong-long=216, Kazakhstan=229, Egypt=262

`country` ต้องเป็น ID ตามรายการ; `page` ต้องมี country และเป็นเลขเต็ม 1–200 ไม่มีศูนย์นำหน้า
ไม่รับ query อื่นหรือ parameter ซ้ำ ทั้งหมดตรวจสอบก่อน upstream

Success เป็น array โดยตรงตาม schema เดิม (รวม `flights`, `period`), `[]` หมายถึงไม่มีรายการจริง
Error เป็น object แยกจาก array:

| HTTP | ความหมาย |
| --- | --- |
| 400 | query ไม่ถูกต้อง |
| 401 | ไม่มี token หรือ token ผิด |
| 503 | environment ของ server ไม่ครบ/ไม่ถูกต้อง |
| 502 | upstream ล้มเหลว รวม timeout, nonce/markup เปลี่ยน, redirect ไม่อนุญาต, ชน safety limit |

ตัวอย่าง error: `{"error":"upstream_http_error","statusCode":502,"diagnostics":{"stage":"ajax","http_status":403}}`
diagnostics มีเฉพาะ stage (`nonce`/`ajax`), HTTP status ถ้ามี response และ `cf_ray` ถ้าผ่านรูปแบบที่อนุญาต
การมี `cf_ray` ไม่ได้ยืนยันว่า Cloudflare เป็นผู้บล็อก ไม่มี raw HTML, cookie, token หรือ nonce ใน error/log

ทุก response ของ handler ใช้ private/no-store, CDN no-store และ `Vary: Authorization`
route ใช้ Node runtime, force-dynamic, revalidate=0, force-no-store; upstream fetch ใช้ no-store ด้วย
ดู [Next.js route segment config](https://nextjs.org/docs/14/app/api-reference/file-conventions/route-segment-config)

ลำดับการดึงคือ GET `/agent-tour-category/` อ่าน nonce จาก `agent_ajax_object` แล้ว POST AJAX ด้วย `URLSearchParams`
ใช้ `tough-cookie` jar แยกแต่ละ inbound request: อ่าน cookie จาก jar ก่อนส่งทุกครั้งและบันทึกทุก Set-Cookie
ดึงตามลำดับเพื่อรองรับ session rotation โดยไม่เกิดการแข่งขันระหว่างหน้า
อนุญาตเฉพาะ origin `https://formosajourneyland.co.th` รวม redirect ทุก hop และไม่ปิด TLS verification
POST redirect รับเฉพาะ 307/308 ที่รักษา method; redirect จำกัด 5 hop

เฉพาะ body `-1` ใน HTTP 200/403 จะ GET nonce ใหม่แล้ว retry หน้าเดิมอีกหนึ่งครั้ง
403 ทั่วไป, 429, 5xx, network error และ timeout ไม่มี automatic retry
หากล้มเหลวหน้าใดหรือประเทศใด จะคืน 502 ทั้งคำขอ ไม่มี partial success

Pagination เริ่มที่ 1 และเพิ่มทีละหน้า หยุดเมื่อ result ว่างหรือเป็นข้อความ
“ไม่พบข้อมูล”/“ไม่พบโปรแกรมทัวร์ที่คุณค้นหา” โดยไม่มี article ทัวร์
เมื่อ pagination เป็นสตริงว่าง จะประมวลผลหน้านั้นก่อนหยุด
ถ้าไม่มี article และไม่ใช่ empty state จะคืน error แทนการตีความว่าไม่มีข้อมูล
หน้าใดซ้ำทั้งหมดจะยังดึงหน้าถัดไป และไม่ตัดที่ 6 หน้า
ที่หน้า 200 หากยังมี pagination จะคืน `pagination_limit_exceeded_use_page` พร้อม 502
การระบุ page โดยตรงจะดึงเฉพาะหน้านั้นได้ รวมหน้า 200

### เรียกจาก curl: หน้าเดียวก่อน แล้วจึงทั้งประเทศและทุกประเทศ

ตัวอย่าง Bash (ตั้ง environment ใน shell อย่างปลอดภัยก่อน ไม่ใส่ secret จริงใน command history):

```bash
export FORMOSA_PROXY_URL='http://localhost:3000/api/formosa'
# FORMOSA_PROXY_TOKEN ต้องอยู่ใน shell environment ด้วย; .env.local ไม่ได้ export ให้ shell
curl --fail-with-body --silent --show-error --max-time 65 \
  -H "Authorization: Bearer ${FORMOSA_PROXY_TOKEN}" "${FORMOSA_PROXY_URL}?country=7&page=1"
curl --fail-with-body --silent --show-error --max-time 65 \
  -H "Authorization: Bearer ${FORMOSA_PROXY_TOKEN}" "${FORMOSA_PROXY_URL}?country=7"
curl --fail-with-body --silent --show-error --max-time 65 \
  -H "Authorization: Bearer ${FORMOSA_PROXY_TOKEN}" "${FORMOSA_PROXY_URL}"
```

PowerShell ใช้ `curl.exe` และตัวแปรจาก environment:

```powershell
$env:FORMOSA_PROXY_URL = 'http://localhost:3000/api/formosa'
curl.exe --fail-with-body --silent --show-error --max-time 65 -H "Authorization: Bearer $env:FORMOSA_PROXY_TOKEN" "$($env:FORMOSA_PROXY_URL)?country=7&page=1"
curl.exe --fail-with-body --silent --show-error --max-time 65 -H "Authorization: Bearer $env:FORMOSA_PROXY_TOKEN" "$($env:FORMOSA_PROXY_URL)?country=7"
curl.exe --fail-with-body --silent --show-error --max-time 65 -H "Authorization: Bearer $env:FORMOSA_PROXY_TOKEN" "$env:FORMOSA_PROXY_URL"
```

ห้ามใช้ verbose/header tracing กับ credential จริง
บน hosting และใน PHP ต้องใช้ URL `https://YOUR_HOST/api/formosa`

### ตั้ง hosting และทดสอบจาก deployed host

1. เลือก Node.js 22+ แล้วตั้ง `FORMOSA_COOKIE` และ `FORMOSA_PROXY_TOKEN` ใน server environment/secret settings ของ hosting
   บน Vercel ให้เลือก environment Production หรือ Preview ที่จะทดสอบให้ตรง และ redeploy หลังตั้งค่า
2. Build: `npm ci && npm run build`; start สำหรับ Node server: `npm start`
   ห้ามใช้ test preload ในการ deploy และห้ามกำหนด credential ใน build arguments ที่ถูกเผยแพร่
3. route กำหนด `maxDuration = 60` วินาที แต่ต้องตรวจค่าที่ hosting ใช้จริงใน deployment settings และแผนบริการ
   ภายในโค้ดจำกัด upstream request ละ 30 วินาที รวมทั้งงาน 50 วินาที รวมอ่าน body/redirect
   ดู [Vercel maximum duration](https://vercel.com/docs/functions/configuring-functions/duration)
   และตรวจ reverse proxy/CDN/PHP timeout ให้รองรับด้วย อย่าอาศัยค่า default ของ hosting
4. เปลี่ยน `FORMOSA_PROXY_URL` ใน curl เป็น HTTPS ของ deployed host ทดสอบไม่มี token ให้ได้ 401
   แล้วทดสอบ `country=7&page=1` ตรวจ array, ภาษาไทย/emoji, ราคาและจำนวนทัวร์
5. หากหน้าเดียวสำเร็จ จึงทดสอบ `country=7` และทุกประเทศ พร้อมวัดระยะเวลาด้วย `--write-out '\nHTTP %{http_code}, seconds %{time_total}\n'`
   ทำซ้ำจาก PHP production เพื่อยืนยันเส้นทาง PHP → Next.js → Formosa จริง
6. หากล้มเหลว เก็บเฉพาะ stage/status/cf-ray ที่ผ่าน validation พร้อมเวลาทดสอบ/region ในบันทึกส่วนตัว
   หากได้ 403 ต้องตรวจ upstream/บัญชี/สิทธิ์และเครือข่ายกับผู้ดูแล Formosa; local สำเร็จไม่พิสูจน์ว่า host นี้เชื่อมได้
   หาก hosting ตัด process ก่อน handler ตอบ อาจเป็น platform error แทน JSON ของเรา; PHP จะเปลี่ยนเป็น statusCode 502

ถ้าทั้งชุดเกิน 50 วินาทีหรือขีดจำกัดของ host: ใช้ PHP cron/worker ดึง `?country=ID` ทีละประเทศ
เก็บผลใน staging และรวมแบบ deduplicate ด้วย mainid จากนั้นสลับข้อมูลจริงแบบ atomic เฉพาะเมื่อครบทุกประเทศ
หากประเทศเดียวใหญ่เกิน ให้ worker ฝั่ง Next.js ที่มีเวลารันยาวเรียก collector ตามลำดับหน้า
แล้วเก็บ snapshot ที่ครบถ้วนในฐานข้อมูล/object storage เพื่อให้ endpoint ที่ยืนยันตัวตนคืน array schema เดิมได้เร็ว
เป็นแนวทางต่อยอด ยังไม่ได้เพิ่ม queue/snapshot ในงานนี้
API แบบระบุ page คืน array เท่านั้นตามระบบเดิม จึงไม่มี pagination metadata ให้ PHP ใช้ตัดสินหน้าสุดท้าย
ถ้าจะไล่ page จาก PHP ต้องกำหนดการจบงานอย่างชัดเจน (เช่นหยุดที่ empty array พร้อม safety limit ที่ต้องเป็น error)
ห้ามใช้หน้าที่ซ้ำทั้งหน้าเป็นสัญญาณจบ และห้ามแทนข้อมูลจริงเมื่อ batch ใดล้มเหลว

### PHP production

นำ method `connectApiProtocol()` จาก [PHP snippet](docs/php/FormosaProxyConnection.php)
ไปแทน method เดิมใน `cms/application/libraries/partner/Formosa.php`
ไฟล์ PHP ของ Travelzeed ไม่อยู่ใน checkout นี้ จึงยังไม่ได้แก้หรือตรวจ caller จริง
snippet อ่าน `FORMOSA_PROXY_URL` และ `FORMOSA_PROXY_TOKEN` จาก `getenv()` ใช้ HTTPS + Bearer,
ตรวจ HTTP/JSON/schema และไม่ตาม redirect
สำเร็จคืน array เดิม; ไม่สำเร็จคืน `['statusCode' => 502, 'error' => 'formosa_proxy_failed']`
รวมกรณี timeout และ hosting error ที่ไม่ใช่ JSON
ตรวจ caller เดิมว่าเมื่อพบ statusCode 502 จะจบ import และรักษาข้อมูลเดิมก่อนสลับ production
อย่าแปลง failure นี้เป็น `[]` เพราะระบบอาจตีความว่าต้องล้างรายการทัวร์

ต้องติดตั้ง ext-curl และ CA certificates ของเครื่อง ไม่ปิด TLS verification
snippet ตั้ง connect timeout 10 วินาที และ total timeout 65 วินาที
ตั้ง PHP/Apache/reverse proxy ให้รอนานพอสำหรับคำขอที่อนุญาต

CodeIgniter ไม่ได้ถูกสมมติว่าอ่าน `.env` อัตโนมัติ ต้องส่ง environment ให้ process PHP จริง:

- PHP-FPM: ตั้งใน pool config เช่น `env[FORMOSA_PROXY_URL] = https://YOUR_HOST/api/formosa`
  และ `env[FORMOSA_PROXY_TOKEN] = "REPLACE_WITH_SHARED_SECRET"` แล้ว reload/restart FPM
  หากใช้ service/container secret ให้ expose ผ่าน pool `env[...]` ตามการตั้ง `clear_env` ของระบบ
- Apache mod_php: ตั้ง `SetEnv FORMOSA_PROXY_URL "https://YOUR_HOST/api/formosa"`
  และ `SetEnv FORMOSA_PROXY_TOKEN "REPLACE_WITH_SHARED_SECRET"` ใน server/vhost config ที่ไม่เผยแพร่ แล้ว restart Apache
  จำกัดสิทธิ์ไฟล์ config; หาก Apache proxy ไป PHP-FPM ให้ตั้ง environment ที่ FPM ด้วย
- CLI/cron: environment ของ cron อาจต่างจาก FPM/Apache ต้องตั้งสองตัวนี้ให้ cron process โดยตรง

ตรวจจาก process/SAPI เดียวกับงาน import ว่า `getenv()` มีค่าทั้งสองด้วย boolean เท่านั้น
ไม่พิมพ์ค่าและไม่เปิด phpinfo สู่ public; ใช้ token เดียวกับ Next.js

### Tests และขอบเขตผล

```powershell
npm test
php -l docs/php/FormosaProxyConnection.php
php -n tests/php/formosa-proxy.test.php
npm run build
npm run test:http
# เพิ่ม 4 assertions ด้วย Postman CLI ที่ติดตั้งอยู่ (ปิด event reporting)
node tests/formosa-http-smoke.js --postman
postman spec lint docs/formosa.openapi.json --issueType syntax --no-report-events
```

Node tests ใช้ parser/cookie jar จริง แต่ mock upstream ด้วย fixture สังเคราะห์
ครอบคลุม auth/validation ก่อน network, mapping/form fields, nonce refresh/retry,
session rotation/isolation, ภาษาไทย/emoji, duration, ราคา/เที่ยวบิน, pagination เกิน 6 หน้า,
dedup, safety limit, HTTP failure, timeout, redirects, ไม่คืน partial และไม่เปิดเผย secret
PHP offline test ใช้ curl doubles ด้วย `php -n`; ไม่พิสูจน์การเชื่อมต่อ HTTPS ของ PHP production
`test:http` เปิด Next.js production build บน loopback port ชั่วคราว ทดสอบด้วย upstream จำลองแล้วปิด process
ต้อง build ก่อนรัน; สคริปต์กำหนด credential สังเคราะห์ของตัวเองและไม่ใช้ cookie จริง
ดูผลการรันและสิ่งที่ยังไม่ได้ยืนยันใน [verification record](docs/formosa-verification.md)

## 1) Install
```bash
npm install
```

## 2) Run locally
```bash
npm run dev
```
Then open:
- http://localhost:3000
- http://localhost:3000/api/get-link  (plain-text link)

## 3) Deploy to Vercel
- Push this folder to GitHub
- In Vercel: New Project -> Import your repo -> Deploy
- After deploy, open: `https://YOUR_DOMAIN.vercel.app/api/get-link`
"# realjourney" 
"# realjourney" 
"# realjourney" 
"# realjourney" 
