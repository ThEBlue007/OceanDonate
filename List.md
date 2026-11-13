# OceanDonate — แผนที่โค้ด

## 1. เทคโนโลยี
- Node.js, Express 5, Socket.IO 4, Mongoose/MongoDB, bcryptjs และ JWT
- Frontend เป็นหน้า HTML/CSS/JavaScript แบบ static อยู่ใน `Frontendd/`

## 2. โครงสร้างไฟล์
- `Backend/server.js` — API, Schema, Socket.IO และ HTTP server
- `Frontendd/index.html` — หน้าแรก/ค้นหาสตรีมเมอร์/ข้อความแนะนำ
- `Frontendd/auth.html` — สมัครและเข้าสู่ระบบ
- `Frontendd/dashboard.html` — ตั้งค่าบัญชี สถิติ ประวัติ และ overlay
- `Frontendd/donate.html` — โปรไฟล์สาธารณะ, หน้าชำระเงิน, แนบสลิป และโหมดทดสอบ
- `Frontendd/widget.html` — Alert overlay
- `Frontendd/goal.html` — Goal overlay
- `Frontendd/top-donator.html` — Leaderboard overlay
- `Backend/test/security.test.js` — Integration/security tests using temporary MongoDB and Socket.IO
- `Backend/server.js` — collection `Donation` สำหรับรายการ pending/confirmed/test และตรวจสลิป EasySlip
- `scripts/scrub-legacy-setting-tokens.js` — dry-run-first cleanup utility for JWTs saved in settings
- `Frontendd/mainstyle.css` — สไตล์ร่วม
- `Frontendd/main.js` — ไฟล์ว่างในขณะสำรวจ
- `Frontendd/image1.png`, `image2.png`, `image3.png`, `logo.png` — รูปภาพประกอบ
- `start-server.bat` — เริ่ม MongoDB และเซิร์ฟเวอร์บน Windows
- `package.json`, `Backend/package.json` — dependencies และคำสั่งเริ่มระบบ
- `package-lock.json`, `Backend/package-lock.json` — lockfile
- `.gitignore` — ไฟล์ที่ไม่ติดตาม
- `.claude/skills/oceandonate-workflow/SKILL.md` — แนวทางเฉพาะของโปรเจกต์

## 3. วิธีรันและค่าตั้งต้น
- `npm start` ที่ root หรือ `npm start` ใน `Backend/`; ค่าเริ่มต้นพอร์ต 3000
- ต้องมี MongoDB; ค่าเริ่มต้น `mongodb://127.0.0.1:27017/ocean_donate`
- รองรับ `MONGODB_URI`, `JWT_SECRET`, `EASYSLIP_API_KEY`, `PORT`; server หยุดเริ่มเมื่อไม่มี `JWT_SECRET`; ไม่มี API key EasySlip จะปิดการรับโดเนทจริง
- `start-server.bat` ใช้เส้นทาง MongoDB ที่ติดตั้งไว้เฉพาะเครื่อง

## 4. Schema
- `User`: username, email, password, widgetToken, stats, pageSettings, socialLinks, bannedWords, paymentMethods, goalSettings, alertSettings, topDonorSettings, history
- `Donation`: userId, username, name, amount, message, imageUrl, paymentMethod, snapshot บัญชีผู้รับ, status (`pending`, `confirmed`, `rejected`, `test`, `deleted`), providerRef, createdAt, date, expiresAt; มี unique index ป้องกันใช้ transaction reference ซ้ำ และ TTL สำหรับรายการ pending ที่หมดเวลา
- รายการเงินจริงที่ยืนยันแล้วถูกเก็บใน `Donation` และยัง mirror ลง `User.history` เพื่อให้หน้าเดิมทำงาน; รายการทดสอบอยู่ใน `Donation` เท่านั้น; migration รายการเก่ายังไม่ทำ
- การเปิดรับเงินจริงต้องบันทึกบัญชีผู้รับใน EasySlip และมี `verifiedAccountId`; เก็บเฉพาะ EasySlip account ID ใน OceanDonate ไม่เก็บ API key ในฐานข้อมูล

## 5. REST API
- `POST /api/register` — สมัครสมาชิก
- `POST /api/login` — เข้าสู่ระบบและออก JWT
- `GET /api/verify` — ตรวจ JWT และส่งข้อมูลผู้ใช้/Widget token
- `GET /api/streamer/:username` — ส่งข้อมูลหน้าโปรไฟล์สาธารณะ
- `GET /api/streamers` — ส่งรายชื่อและ bio ของผู้ใช้
- `POST /api/donations` — สร้าง pending donation และ QR/ข้อมูลบัญชีตามวิธีชำระเงิน; จำกัดยอด 1–50,000 บาท และอายุรายการ 30 นาที
- `POST /api/donations/:id/slip` — ตรวจรูปสลิปกับ EasySlip, ผู้รับ/บัญชี/ชื่อ/ยอด/รายการซ้ำ; ยืนยันแล้วจึงเพิ่มยอดและส่ง alert
- `POST /api/donations/test` — เก็บ log และส่ง OBS test alert โดยไม่แก้ยอด, Goal หรือ leaderboard
- Static files ให้บริการจาก `Frontendd/`

## 6. Socket.IO Events
- Client→Server: `auth_dashboard`, `join_widget`, `join_profile`, `new_donation` (deprecated; ปฏิเสธการเพิ่มยอด), `test_alert`, `regenerate_widget_token`, `delete_donation`, `reset_stats`, `save_payment`, `save_page_settings`, `save_social`, `save_banned_words`, `update_goal`, `update_alert`, `update_top_donor`
- คำสั่งตั้งค่าหลังบ้านส่วนใหญ่เรียก `checkAuth`; `join_profile` และ `new_donation` เป็นสาธารณะ แต่ `new_donation` ไม่บันทึกยอด; การ test ของผู้โดเนทใช้ REST ที่มี rate limit
- `join_widget` ต้องใช้ `widgetToken`; username อย่างเดียวเข้าไม่ได้
- ห้องแยกเป็น `owner:<username>`, `widget:<username>`, `public:<username>`; ข้อมูลประวัติ/สถิติส่งเฉพาะ owner, alert ส่งเฉพาะ widget, leaderboard ส่งให้ทุกกลุ่มตามการใช้งาน
- `goalSettings`, `alertSettings`, `topDonorSettings` ผ่าน whitelist ก่อนบันทึกและส่งออกเพื่อไม่ให้ JWT จาก client ถูกเก็บ/ส่งต่อ
- Server→Client: `auth_error`, `auth_success`, `update_stats`, `update_history`, `apply_page_settings`, `apply_payment`, `apply_social`, `apply_banned_words`, `apply_security_settings`, `apply_goal`, `apply_settings`, `apply_top_donor`, `update_leaderboard`, `show_alert`, `donation_rejected` (legacy `new_donation`), `payment_error`, `notify_success`

## 7. Logic หลัก
- Login เก็บ JWT ใน localStorage; Dashboard ตรวจผ่าน REST แล้วเชื่อม Socket.IO
- Widget ใช้ Widget token เพื่อเข้าห้องของ overlay; Dashboard, Widget และหน้าโปรไฟล์แยกห้องกัน
- โดเนทจริงเริ่มเป็น `pending`; ผู้โดเนทแนบสลิปแล้ว server เรียก EasySlip โดยไม่เชื่อจำนวนเงินจากผล client, ตรวจ matchAccount/matchAmount/checkDuplicate และเทียบเลขบัญชี/ชื่อ/ธนาคารกับผู้รับที่ลงทะเบียนไว้; MongoDB transaction เปลี่ยนเป็น confirmed พร้อมอัปเดต history/stats/Goal ก่อนส่ง OBS alert/leaderboard
- โหมดทดสอบสร้าง Donation status `test`, ลง log ใน Dashboard และส่ง OBS test alert แต่ไม่นับ stats/Goal/leaderboard; event เก่า `new_donation` ถูกปิด
- Top donors รวมยอดตามชื่อแบบตรงตัวจาก history ทั้งหมด
- หน้า donate สร้าง QR พร้อมเพย์ตามเบอร์และยอดรายการผ่าน PromptPay.io; ต้องแนบสลิปหลังโอนเพื่อให้ EasySlip ยืนยัน; หน้า donate ยังมีช่องทางโอนธนาคารและ Test Donation

## 8. ข้อสังเกต / ความเสี่ยงที่พบ
- ประเด็นที่ยังค้างและงาน production ที่ต้องทำด้วยคนอยู่ใน `Issue.md`; ช่องโหว่เฟส 1 ที่แก้ใน branch ปัจจุบันระบุสถานะไว้ในรายงาน
- `npm audit --omit=dev` พบ 7 advisories ใน production dependency (1 critical, 5 high, 1 moderate); ยังไม่ได้อัปเดตแพ็กเกจ
- ผู้ใช้แจ้งว่าตั้ง `EASYSLIP_API_KEY` บน Render แล้ว แต่ยังไม่ได้ทดสอบ API จริง; ต้องยืนยันว่าเงื่อนไข/KYC ของ EasySlip รองรับการเก็บบัญชีผู้รับของ streamer หลายคนใน branch เดียวก่อนเปิดเงินจริง; รายการเก่าคงอยู่ใน User.history จนกว่าจะทำ migration

## 9. สิ่งที่สำรวจจริง / ยังไม่ได้ลงลึก
- อ่าน Backend ทั้งไฟล์; สแกนรูปแบบและจุดทำงานสำคัญของหน้า HTML/JS, ตรวจ stylesheet, package manifests, launcher และ workflow โดยไม่ได้อ่านทุกบรรทัดของทุกหน้า
- integration tests 8 รายการผ่านด้วย MongoDB replica set ชั่วคราว, Socket.IO และ EasySlip mock server; ยังไม่ได้ยิง EasySlip จริง, browser จริง, production/Render หรือฐานข้อมูลจริง
- หน้า XSS ถูกจำลองด้วย jsdom; ยังไม่ได้ทดสอบใน browser จริง
- `List.md` ไม่อยู่ใน workspace ตอนเริ่มงาน; สร้างแผนที่นี้จากโค้ดที่มี

## 10. Change Log
| วันที่ | ไฟล์ | สิ่งที่เปลี่ยน | เหตุผล |
|---|---|---|---|
| 2026-11-13 | `List.md` | สร้างแผนที่ระบบจากไฟล์ที่ตรวจพบ | ไม่มี List.md เดิม |
| 2026-11-13 | `Issue.md` | บันทึกบัคและแผนแก้ไขเพื่อทบทวน | ตามคำขอสำรวจ โดยยังไม่แก้โค้ด |
| 2026-11-13 | `Backend/server.js`, `Frontendd/*.html`, `Backend/test/`, `scripts/` | ปิดการรั่ว JWT/ข้อมูลเจ้าของผ่าน Socket, ปิด username fallback, แก้ stored XSS และตรวจ Social URL; เพิ่มเทสต์และสคริปต์ scrub แบบ dry-run | เริ่มเฟส 1 หลังยืนยันว่าเว็บใช้งานจริง; ยังไม่แตะ production |
| 2026-11-13 | `Backend/package-lock.json` | เพิ่ม test dependencies; audit production dependencies พบ 7 advisories ที่ต้องวางแผนอัปเดต | รองรับ integration tests และบันทึกความเสี่ยงที่ตรวจพบ |
| 2026-11-14 | `Backend/server.js`, `Frontendd/dashboard.html`, `Frontendd/donate.html`, `Backend/test/security.test.js`, `List.md`, `Issue.md` | เพิ่ม pending/confirmed/test Donation flow, ตรวจสลิปผ่าน EasySlip, match ผู้รับ/ชื่อ/ยอด/รายการซ้ำ, จำกัดรายการและเก็บ log Test โดยไม่คิดยอด; เพิ่มธนาคารที่รองรับและย้ายการลบประวัติไปใช้อ้างอิง ID | ปิดการเพิ่มยอดผ่าน `new_donation` โดยไม่ยืนยันเงินจริงและทำตาม flow ที่ผู้ใช้เลือก; ผู้ใช้แจ้งภายหลังว่าตั้ง API key แล้ว แต่ยังไม่ได้ทดสอบการเชื่อมต่อจริงหรือ deploy โค้ดชุดนี้ |
