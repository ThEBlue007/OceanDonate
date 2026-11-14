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
- `Frontendd/widget.html` — Alert overlay with durable queue and gift effects
- `Frontendd/timer.html` — OBS timer overlay
- `Frontendd/goal.html` — Goal overlay
- `Frontendd/top-donator.html` — Leaderboard overlay
- `Backend/test/security.test.js` — Integration/security tests using temporary MongoDB and Socket.IO
- `Backend/server.js` — collection `Donation` สำหรับรายการ pending/confirmed/test และตรวจสลิป EasySlip
- `scripts/scrub-legacy-setting-tokens.js` — dry-run-first cleanup utility for JWTs saved in settings
- `.agents/skills/` — Agent Skills สำหรับ workflow/TDD, frontend, backend architecture, MongoDB, code simplification และ security review
- `skills-lock.json` — รายการแหล่งและเวอร์ชันของ Agent Skills ที่ติดตั้งด้วย skills.sh
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
- Google OAuth: `APP_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; Discord OAuth: `APP_BASE_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`; password reset email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `APP_BASE_URL` (ดู `docs/superpowers/operations/oauth-email-setup.md`)
- `start-server.bat` ใช้เส้นทาง MongoDB ที่ติดตั้งไว้เฉพาะเครื่อง

## 4. Schema
- `User`: username, email, optional password, authVersion, widgetToken, stats, pageSettings (including layout/theme), socialLinks, bannedWords, paymentMethods, goalSettings, alertSettings, topDonorSettings, timerSettings, timerState, alertControl, history
- `AuthIdentity`, `OAuthAttempt`, `OAuthSignup`, `OAuthHandoff`, `PasswordResetToken`: provider identity and hashed short-lived OAuth/reset flow tokens; temporary flows use expiry indexes
- `AlertQueue`: durable, unique-per-donation OBS queue with queued/playing/played/skipped states and playback lease
- `GiftCatalogItem`: owner-scoped fixed-price gift catalog; `Donation.giftSnapshot` preserves the selected gift details on a pending order
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
- Client→Server: `auth_dashboard`, `join_widget`, `join_profile`, `new_donation` (deprecated; ปฏิเสธการเพิ่มยอด), `test_alert`, `pause_alerts`, `resume_alerts`, `skip_current_alert`, `alert_finished`, `timer_config`, `timer_start`, `timer_set`, `timer_adjust`, `save_gifts`, `regenerate_widget_token`, `delete_donation`, `reset_stats`, `save_payment`, `save_page_settings`, `save_social`, `save_banned_words`, `update_goal`, `update_alert`, `update_top_donor`
- คำสั่งตั้งค่าหลังบ้านส่วนใหญ่เรียก `checkAuth`; `join_profile` และ `new_donation` เป็นสาธารณะ แต่ `new_donation` ไม่บันทึกยอด; การ test ของผู้โดเนทใช้ REST ที่มี rate limit
- `join_widget` ต้องใช้ `widgetToken`; username อย่างเดียวเข้าไม่ได้
- ห้องแยกเป็น `owner:<username>`, `widget:<username>`, `public:<username>`; ข้อมูลประวัติ/สถิติส่งเฉพาะ owner, alert ส่งเฉพาะ widget, leaderboard ส่งให้ทุกกลุ่มตามการใช้งาน
- `goalSettings`, `alertSettings`, `topDonorSettings` ผ่าน whitelist ก่อนบันทึกและส่งออกเพื่อไม่ให้ JWT จาก client ถูกเก็บ/ส่งต่อ
- Server→Client: `auth_error`, `auth_success`, `update_stats`, `update_history`, `apply_page_settings`, `apply_payment`, `apply_social`, `apply_banned_words`, `apply_security_settings`, `apply_goal`, `apply_settings`, `apply_top_donor`, `apply_timer`, `apply_alert_control`, `stop_alert`, `apply_gifts`, `update_leaderboard`, `show_alert`, `donation_rejected` (legacy `new_donation`), `payment_error`, `notify_success`

## 7. Logic หลัก
- Login เก็บ JWT ใน localStorage; Dashboard ตรวจผ่าน REST แล้วเชื่อม Socket.IO
- Widget ใช้ Widget token เพื่อเข้าห้องของ overlay; Dashboard, Widget และหน้าโปรไฟล์แยกห้องกัน
- โดเนทจริงเริ่มเป็น `pending`; ผู้โดเนทแนบสลิปแล้ว server เรียก EasySlip โดยไม่เชื่อจำนวนเงินจากผล client, ตรวจ matchAccount/matchAmount/checkDuplicate และเทียบเลขบัญชี/ชื่อ/ธนาคารกับผู้รับที่ลงทะเบียนไว้; MongoDB transaction เปลี่ยนเป็น confirmed พร้อมอัปเดต history/stats/Goal ก่อนส่ง OBS alert/leaderboard
- โหมดทดสอบสร้าง Donation status `test`, ลง log ใน Dashboard และส่ง OBS test alert แต่ไม่นับ stats/Goal/leaderboard; event เก่า `new_donation` ถูกปิด
- Top donors รวมยอดตามชื่อแบบตรงตัวจาก history ทั้งหมด
- OAuth รองรับ Google/Discord เมื่อกำหนด credentials; บัญชีใหม่ต้องยืนยันอีเมลและตั้ง username; การผูกบัญชีเดิมเริ่มจากบัญชีที่ล็อกอินอยู่เท่านั้นและไม่ auto-link ด้วยอีเมล; reset password ใช้ลิงก์ครั้งเดียวและยกเลิก JWT รุ่นเก่า
- Timer ใช้ `endsAt` ฝั่ง server, กฎยอดไม่ทับช่วง, ไม่มีเพดานธุรกิจ; เวลาที่ได้/ตั้งขณะหยุดหรือหลังถึงศูนย์เก็บเป็นโบนัสไลฟ์ถัดไป
- Timer ตั้งรูปแบบสี ฟอนต์ ข้อความ ตำแหน่ง และเอฟเฟกต์ได้ในแท็บ “รูปแบบ”; กฎจำนวนเงินแยกในแท็บ “กฎการโดเนท” และส่งค่ารูปแบบไปยัง OBS ผ่าน Socket.IO
- คิว OBS บันทึกใน MongoDB หลังยืนยันเงินจริง; pause เก็บรายการไว้, skip ข้ามรายการที่กำลังเล่น, widget ยืนยันจบเพื่อเลื่อนคิว; Test เล่นทันทีและไม่บันทึกยอด
- Gift ใช้ราคาจาก catalog ฝั่ง server และ snapshot ราคา/เอฟเฟกต์ในรายการ; Dashboard มีคลังของขวัญสำเร็จรูป ค้นหา/กรองหมวด และเปิด/ปิดรายการได้; รองรับสูงสุด 48 รายการ 12 ไอคอน และ 8 เอฟเฟกต์ที่กำหนดไว้; หน้า Donate มี 3 layouts/3 themes และ Preview ที่ปิดการส่งเงิน
- Alert มี 6 ธีมสำเร็จรูปและฟอนต์ภาษาไทย 8 แบบ; ฟอนต์และธีมถูกตรวจด้วย allowlist ฝั่ง server และแสดงผลใน OBS Widget
- หน้า donate สร้าง QR พร้อมเพย์ตามเบอร์และยอดรายการผ่าน PromptPay.io; ต้องแนบสลิปหลังโอนเพื่อให้ EasySlip ยืนยัน; หน้า donate ยังมีช่องทางโอนธนาคารและ Test Donation

## 8. ข้อสังเกต / ความเสี่ยงที่พบ
- ประเด็นที่ยังค้างและงาน production ที่ต้องทำด้วยคนอยู่ใน `Issue.md`; ช่องโหว่เฟส 1 ที่แก้ใน branch ปัจจุบันระบุสถานะไว้ในรายงาน
- `npm audit --omit=dev` พบ 7 advisories ใน production dependency (1 critical, 5 high, 1 moderate); ยังไม่ได้อัปเดตแพ็กเกจ
- ผู้ใช้แจ้งว่าตั้ง `EASYSLIP_API_KEY` บน Render แล้ว แต่ยังไม่ได้ทดสอบ API จริง; การลงทะเบียนบัญชีผู้รับกับ EasySlip ต้องสำเร็จก่อนช่องทางเงินจริงจะแสดง; ต้องยืนยันเงื่อนไข/KYC ของ EasySlip ก่อนเปิดเงินจริง; รายการเก่าคงอยู่ใน User.history จนกว่าจะทำ migration

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
| 2026-11-14 | `Backend/server.js`, `Frontendd/dashboard.html`, `List.md`, `Issue.md` | แยกข้อความผิดพลาดตอนลงทะเบียนบัญชีผู้รับ EasySlip ออกจากข้อผิดพลาดตรวจสลิป; รองรับค้นหาและเชื่อมบัญชีเดิมโดยจับคู่ธนาคาร/เลขบัญชีแล้วใช้ชื่อ canonical จาก EasySlip; แก้ประกอบ URL ให้รักษา path `/v2`; เพิ่มคำแนะนำในฟอร์ม | หน้า production แสดงเฉพาะ Test Donation เพราะ endpoint EasySlip ถูกเรียกผิด path; ข้อมูลฟอร์มเดิมไม่บอกเลขเต็มและรูปแบบชื่อที่ต้องใช้ |
| 2026-11-14 | `.agents/skills/`, `skills-lock.json`, `List.md` | ติดตั้ง Agent Skills 14 รายการสำหรับ workflow/TDD, frontend/UI, backend, MongoDB, code simplification และ security review พร้อมบันทึกโครงสร้างไฟล์ | เพิ่มแนวทางที่ Codex เรียกใช้ได้ในงานพัฒนาเว็บ Full Stack |
| 2026-11-14 | `Frontendd/dashboard.html`, `Frontendd/donate.html`, `Backend/test/ui.test.js`, `List.md` | ทำ Timer preview ให้เปลี่ยนตามค่าที่ยังไม่บันทึก, เปลี่ยนปุ่มเป็นเพิ่ม/ลดเวลา, ใช้ toast แทนกล่อง alert ใน Dashboard, แสดงตัวอย่างของขวัญที่เลือก และปรับ dropdown หน้า Dashboard/Donate ให้เป็นชุดเดียวกัน | แก้ UX ตามการใช้งานจริงที่ผู้ใช้แจ้ง พร้อมเพิ่ม regression tests สำหรับตัวอย่างสด, ปุ่ม Timer, toast และของขวัญ |
| 2026-11-14 | `Frontendd/dashboard.html`, `Frontendd/donate.html`, `Frontendd/widget.html`, `Backend/server.js`, `Backend/test/`, `List.md` | แทนกล่องยืนยันเบราว์เซอร์ด้วย modal ของเว็บที่มีปุ่มยกเลิก/ยืนยันและ focus control; แสดงของขวัญเป็นการ์ดไอคอน/ราคา/เอฟเฟกต์ก่อนเลือก; แนบ giftSnapshot ใน Test Donation; บังคับเริ่มเอฟเฟกต์ OBS ใหม่ทุกครั้งและเพิ่มความเด่น; ส่ง toast หลังรีเซ็ตสำเร็จ | แก้การยืนยันที่ดูไม่เข้ากับเว็บ, ทำให้ของขวัญเข้าใจง่ายก่อนเลือก, และปิดช่องว่างที่ทำให้ Test Donation ไม่มี effect บน OBS |
| 2026-11-14 | `Backend/server.js`, `Backend/test/security.test.js`, `Frontendd/auth.html`, `Frontendd/dashboard.html`, `Frontendd/donate.html`, `Frontendd/widget.html`, `Frontendd/timer.html`, `docs/superpowers/operations/oauth-email-setup.md`, `List.md` | เพิ่ม Google/Discord OAuth และ password reset, ปุ่มคุม alert พร้อมคิวที่ทนต่อ OBS reconnect, timer และโบนัสนอกไลฟ์, gift ราคา fix พร้อมเอฟเฟกต์, 3 รูปแบบ/3 theme หน้า Donate และ Preview | ทำตามข้อกำหนดที่ยืนยันไว้; integration tests ผ่าน 15/15; OAuth/SMTP ต้องตั้งค่าบน Render ก่อนเปิดให้ใช้; ยังไม่ deploy production |
| 2026-11-14 | `Backend/server.js`, `Backend/test/security.test.js`, `Frontendd/dashboard.html`, `Frontendd/widget.html`, `Frontendd/timer.html`, `List.md`, `docs/superpowers/plans/2026-11-14-timer-gift-alert-visuals.md` | แยก Timer เป็นแท็บรูปแบบ/กฎและเพิ่มตัวเลือกหน้าตาส่งถึง OBS; เพิ่มฟอนต์ Alert ภาษาไทย 8 แบบและธีม Alert 6 แบบ; เพิ่มคลังของขวัญสำเร็จรูป ค้นหา/กรองหมวด เปิดปิดจำนวนมาก และเพิ่มไอคอน/เอฟเฟกต์ที่ allowlist รวม 12/8 แบบ | ให้ Dashboard ใกล้ภาพอ้างอิงและเพิ่มตัวเลือก โดยรักษาการคิดยอดและการยืนยันการโดเนทแบบเดิม; เพิ่มเทสต์ แต่ integration suite ยังรันไม่ได้เพราะดาวน์โหลด MongoDB binary ไม่สำเร็จในสภาพแวดล้อมนี้ |
| 2026-11-14 | `Frontendd/donate.html`, `Frontendd/dashboard.html`, `Frontendd/widget.html`, `Backend/test/ui.test.js`, `Backend/test/security.test.js`, `List.md` | ย่อรายการของขวัญเป็นแผงพับได้และจำกัดความสูงเมื่อเปิด; ซ่อน URL OBS ภายในแผงพับแต่แยกปุ่มคัดลอกไว้นอกแผง; เพิ่ม particle/flash layer เต็มจอสำหรับเอฟเฟกต์ของขวัญ OBS พร้อม fallback เมื่อเปิด reduced motion | ลดความยาวหน้า Donate และซ่อน Stream Key จากสายตาเริ่มต้นโดยไม่เพิ่มขั้นตอนการคัดลอก; ทำให้ของขวัญต่างจาก alert ปกติอย่างเห็นได้ชัด |
| 2026-11-14 | `Backend/alert-resume-scheduler.js`, `Backend/server.js`, `Backend/test/security.test.js`, `Backend/test/ui.test.js`, `Frontendd/dashboard.html`, `List.md` | ตั้งเวลาเรียกคิว Alert ต่ออัตโนมัติเมื่อครบช่วงพักและยกเลิกกำหนดเดิมเมื่อกดเล่นต่อ/พักใหม่; เพิ่มผลตอบกลับว่าข้ามรายการสำเร็จหรือไม่มี Alert กำลังเล่น; อธิบายว่าระหว่างพักยังรับโดเนทและเก็บ Alert เข้าคิว | แก้คิวที่ไม่เริ่มเองเมื่อหมดเวลาพักและปุ่มข้ามที่ไม่แสดงผลตอบกลับ; ยืนยันการทำงานของคิวด้วย Integration tests |
| 2026-11-14 | `Backend/server.js`, `Backend/test/security.test.js`, `Backend/test/ui.test.js`, `Frontendd/dashboard.html`, `List.md` | เปลี่ยนปุ่มพักให้หยุด Alert ที่กำลังเล่นและคืนรายการไว้หน้าคิว; เล่นต่อ/ข้าม/พักมีข้อความยืนยันบน Dashboard; แจ้งเมื่อ Socket เชื่อมต่อไม่ได้ | ปุ่มพักเดิมกันเฉพาะรายการถัดไปจนดูเหมือนไม่ทำงาน; เพิ่ม integration test ยืนยันหยุดและเก็บรายการปัจจุบันระหว่างพัก |
| 2026-11-14 | `Backend/server.js`, `Backend/test/security.test.js`, `Backend/test/ui.test.js`, `Frontendd/dashboard.html`, `List.md` | เพิ่ม Socket acknowledgement และ timeout feedback สำหรับปุ่มคุม Alert; ให้ปุ่มข้ามเลือก Alert ที่ถูกพักค้างอยู่ได้; เพิ่มตัวเลือกเรียงประวัติโดเนทใหม่ไปเก่าหรือเก่าไปใหม่ พร้อมรักษาการลบรายการด้วย ID เดิม | แก้กรณีคำสั่งคุม Alert เงียบเมื่อไม่ได้รับการตอบกลับ และเพิ่มการเรียงประวัติตามเวลาจริงโดยไม่ทำให้ index เปลี่ยนเป้าหมายการลบ |
| 2026-11-14 | `Backend/server.js`, `Backend/test/security.test.js`, `Backend/test/ui.test.js`, `Frontendd/dashboard.html`, `List.md` | ส่ง Test Donation และ OBS test alert เข้า AlertQueue เพื่อให้พัก/เล่นต่อ/ข้ามได้จริง; ยืนยันการบันทึกกฎ Timer ผ่าน Socket acknowledgement; รวมยอดปลายช่วงของกฎ Timer; เพิ่มเรียงประวัติตามจำนวนเงินและตัวกรองรายการทดสอบ; ปรับ Preview ให้ดูได้ทั้งจอคอม/มือถือและอัปเดตพื้นหลัง/ข้อความแบบทันที | สาเหตุเดิมคือเส้นทางทดสอบยิง Alert ตรงจึงหลบคิวควบคุม; เพิ่ม integration/UI regression tests สำหรับพฤติกรรมเหล่านี้ |
| 2026-11-14 | `Backend/server.js`, `Frontendd/timer.html`, `Backend/test/ui.test.js`, `List.md` | OBS Timer แสดงเวลาเริ่มรอบถัดไปรวมโบนัสเมื่อหยุดอยู่ และแสดงสถานะโบนัส; แยกสถานะหมดเวลาจริงเพื่อให้แสดง 00:00:00 ได้ถูกต้อง | กฎโดเนทที่ยืนยันแล้วสะสมเวลาไว้ในโบนัสเมื่อ Timer ยังไม่เริ่มตามที่กำหนด แต่ OBS Timer เดิมแสดง 00:00:00 จึงมองไม่เห็นเวลาที่ได้รับ; เพิ่ม UI regression test สำหรับโบนัส/เวลาที่กำลังเดิน/หมดเวลา |
| 2026-11-14 | `docs/superpowers/specs/oceandonate-ui-rework.md`, `docs/superpowers/plans/2026-11-14-oceandonate-ui-rework.md`, `List.md` | บันทึกทิศทางออกแบบและแผนปรับ UI ทุกหน้า โดยอิงสีจาก `Frontendd/logo.png`; ยังไม่มีการเปลี่ยน UI | แยกงานเป็นช่วงที่ตรวจรับได้ และล็อกขอบเขตให้คงระบบชำระเงิน/บัญชี/OBS เดิม |
