# Formosa verification record

วันที่ทดสอบ: 2026-10-15 บน Windows local, Node.js 22.14.0, PHP CLI 7.4.33, Postman CLI 1.74.0

| ประเภทหลักฐาน | คำสั่ง / สิ่งที่ทดสอบ | ผล |
| --- | --- | --- |
| Mock upstream + parser/cookie jar จริง | `npm test` | 22 tests ผ่าน, exit 0 |
| Local production build | `npm run build` | compile/type/lint/build ผ่าน, `/api/formosa` เป็น dynamic route, exit 0 |
| Local HTTP ของ Next.js + mock upstream | `npm run test:http` | 29 checks ผ่าน, exit 0 |
| Postman เรียก Next.js local HTTP + mock upstream | `node tests/formosa-http-smoke.js --postman` | Postman 4 assertions ผ่าน, exit 0; รวม local runner 30 checks, ปิด event reporting |
| OpenAPI syntax | `postman spec lint docs/formosa.openapi.json --issueType syntax --no-report-events` | ไม่พบปัญหา, exit 0 |
| PHP snippet syntax | `php -l docs/php/FormosaProxyConnection.php` | ผ่าน, exit 0 |
| PHP + curl doubles (ไม่ต่อ network) | `php -n tests/php/formosa-proxy.test.php` | 29 checks ผ่าน, exit 0 |
| Live Formosa จาก local Node.js ผ่าน route handler | session cookie ที่ผู้ใช้ให้ในรอบถัดมา; `?country=7&page=1` | HTTP 200, 3 ทัวร์ |
| Live Formosa จาก local Node.js ผ่าน route handler | `?country=7` | HTTP 200, 3 ทัวร์ / 3 mainid, ประมาณ 2 วินาที |
| Live Formosa จาก local Node.js ผ่าน route handler | ไม่ระบุ query: ทุกประเทศ | HTTP 200, 100 ทัวร์ / 100 mainid, ประมาณ 11.5 วินาที |
| Local Next.js HTTP → live Formosa ในรอบใช้ cookie จริง | ยังไม่ได้ยืนยันผ่าน HTTP; การลอง `next start` ไม่สำเร็จเพราะ `.next/BUILD_ID` ไม่มีในขณะทดสอบ | ผล live ด้านบนเรียก route handler โดยตรง ไม่ใช่ HTTP server |
| Live Formosa จาก deployed Next.js host | ยังไม่มี URL/สิทธิ์และ environment ของ deployment ที่ใช้ทดสอบ | ยังไม่ยืนยัน |
| PHP production → deployed Next.js → Formosa | PHP production/caller จริงไม่อยู่ใน checkout นี้ | ยังไม่ยืนยัน |

ไม่มีการนำ cookie เดิมที่พบใน source ไปใช้ทดสอบ live และไม่ส่ง credential จริงไป Postman
การทดสอบ live ใช้ cookie ที่ผู้ใช้ให้ภายหลัง เก็บใน `.env.local` ซึ่งถูก git-ignore และสร้าง proxy token สุ่ม 32 bytes ฝั่งเครื่อง
ไม่มีการบันทึกค่าลับหรือ raw response ลงในบันทึกนี้ ต้องตั้ง environment ใหม่บน hosting/PHP แยกจาก local
Mock ทดสอบ contract/logic/session jar/การอ่าน Set-Cookie แต่ไม่พิสูจน์ IP egress, WAF, สิทธิ์บัญชี
หรือการเชื่อมต่อ Formosa ของ hosting เป้าหมาย

ไฟล์ `tests/formosa-upstream-preload.js` ใช้เฉพาะ local HTTP runner ห้ามใส่ใน NODE_OPTIONS หรือ start command บน hosting
runner ใช้ environment สังเคราะห์ เปิด Next.js ด้วย `next start` และปิด server เมื่อจบงาน
กรณี country=6 ใน mock ถูกออกแบบให้หน้า 2 ล้มเหลว เพื่อพิสูจน์ว่าไม่คืน partial success

## ต้องตรวจหลัง deploy

1. ยืนยัน runtime Node.js 22+ และ environment ของ deployment; เปลี่ยน session cookie ที่เคยอยู่ใน source
2. ตรวจค่าจริงของ hosting function duration, CDN/reverse proxy timeout และขนาด response ที่อนุญาต
   โค้ดนี้กำหนด function maxDuration 60s, upstream budget รวม 50s, request ละ 30s
   ค่าเหล่านี้ยังไม่ได้ยืนยันกับแผนบริการ/region ของ host เป้าหมาย
3. เรียก deployed HTTPS endpoint โดยไม่ส่ง token ต้องได้ 401 และไม่มี upstream call
4. เรียก `?country=7&page=1` โดยใช้ token จาก environment ตรวจ schema/ภาษา/ราคาเทียบข้อมูลจริง
5. ทดสอบญี่ปุ่นทุกหน้า แล้วจึงทุกประเทศ จด HTTP status, ระยะเวลา, จำนวน mainid ที่ไม่ซ้ำ
6. หากล้มเหลว ใช้เฉพาะ diagnostics stage/status/cf-ray ที่ผ่าน validation; cf-ray ไม่พิสูจน์สาเหตุการบล็อก
7. ติดตั้ง method ใน PHP production ตั้ง environment ของ SAPI/cron ให้ถูกต้อง แล้วเรียกผ่าน PHP จริง
8. ยืนยัน caller รักษาข้อมูลเดิมเมื่อ method คืน statusCode 502 ก่อนเปิด import จริง
9. ถ้างานทั้งชุดเกินเวลา ให้ใช้ staging/atomic import แบบแบ่งประเทศ หรือ worker/snapshot ตาม README

ผล mock/local ที่ผ่านยังไม่ใช่หลักฐานว่าปัญหา HTTP 403 บน production แก้แล้ว
