# รายงานบัคและแผนแก้ไข

ขอบเขต: ตรวจไฟล์ทั้งหมดที่อยู่นอก dependencies (`node_modules/`) เพื่อทำแผนที่; อ่าน `Backend/server.js` ทั้งไฟล์ และค้นจุดเชื่อมต่อสำคัญใน HTML/JavaScript ทุกหน้า (เช่น Socket, การแสดง HTML, API, การชำระเงิน) รวมถึงตรวจ launcher/manifest/workflow และ stylesheet เบื้องต้น การอ่านหน้าเว็บเป็นการไล่ตามจุดเสี่ยง ไม่ใช่ทบทวนทุกบรรทัด ดังนั้นอาจยังมีประเด็นอื่นที่ไม่อยู่ในรายการ

สถานะ: แก้โค้ดเฟส 1 ใน branch `codex/phase-1-security` และเทสต์ integration ผ่านแล้ว ยังไม่ได้ deploy, เปลี่ยน JWT secret บน Render, สำรอง/แก้ฐานข้อมูลจริง หรือทำเฟส 2 เป็นต้นไป

## 1. [แก้ในโค้ดเฟส 2; ต้องตั้ง EasySlip และตรวจจริงก่อน production] สร้างรายการโดเนทและเพิ่มยอดได้โดยไม่ยืนยันการจ่ายเงินจริง

- **ไฟล์/จุดที่พบ:** `Backend/server.js` บรรทัด 350–417; `Frontendd/donate.html` บรรทัด 217–234, 581–594
- **อาการก่อนแก้:** Socket event `new_donation` รับ amount/name/message จาก client แล้วบันทึกและเพิ่มสถิติ/Goal ทันที โดยไม่มีการยืนยันการจ่าย
- **แนวทางที่ทำในเฟส 2:** `new_donation` ปฏิเสธการเพิ่มยอด; REST สร้าง `Donation` สถานะ pending, จำกัดยอด 1–50,000 บาท, จำกัดจำนวนคำขอต่อ IP และหมดอายุใน 30 นาที; เมื่อแนบสลิป server ส่งภาพไป EasySlip ด้วย `matchAccount`, `matchAmount`, `checkDuplicate`, เทียบผู้รับจากบัญชี/ธนาคาร/ชื่อที่ streamer ลงทะเบียน, ป้องกัน `transRef` ซ้ำด้วย unique index และยืนยันพร้อมอัปเดต `User` ใน MongoDB transaction ก่อนส่ง alert/leaderboard. โหมดทดสอบเก็บ log แยกและส่ง OBS alert โดยไม่แตะยอด/Goal/อันดับ
- **ข้อจำกัด:** QR ที่ใช้เป็น QR พร้อมเพย์ระบุผู้รับและยอดผ่าน PromptPay.io; ไม่ใช่ webhook จากธนาคารและไม่ผูก ref ของ Donation ID ลงใน QR. ระบบจะรู้ผลหลังผู้โดเนทแนบสลิปเท่านั้น. ต้องตั้ง `EASYSLIP_API_KEY`, KYC/สมัคร EasySlip, และลงทะเบียนบัญชีผู้รับของ streamer ใน EasySlip ก่อนเปิดรับจริง; สลิป Bangkok Bank อาจยังตรวจไม่ได้ทันทีตามผู้ให้บริการและต้องให้ผู้จ่ายลองใหม่ภายหลัง
- **เหตุผลที่แนะนำ:** การตรวจบนหน้าเว็บหรือซ่อนปุ่มไม่ป้องกันการเรียก Socket event โดยตรง
- **ข้อดี:** payload จาก client อย่างเดียวเพิ่มยอดไม่ได้; ยอดและ alert จะเกิดหลังตรวจผู้รับ/ยอด/รายการซ้ำ; มีสถานะ pending และ test logs แยกจากยอดจริง
- **ข้อเสีย/ต้นทุน:** ต้องมีค่าใช้บริการ/API quota และส่งภาพสลิปให้ผู้ให้บริการภายนอก; อาจมีความล่าช้า/ตรวจไม่ผ่าน; การยืนยันยังเกิดหลังผู้โดเนทอัปโหลดสลิป ไม่ใช่ real-time notification จากบัญชี
- **ความมั่นใจ:** สูงมาก — เส้นทางจาก event ถึงการบันทึกและ broadcast ปรากฏชัดในโค้ด
- **สถานะ:** โค้ดเฟส 2 และ integration tests ที่ใช้ EasySlip mock ผ่านแล้ว; ผู้ใช้แจ้งว่าตั้ง API key บน Render แล้ว แต่ยังไม่ได้ทดสอบ API จริง/ลงทะเบียนบัญชี streamer จริง, ทำ migration history เก่า หรือ deploy โค้ดชุดนี้. ห้ามเปิดช่องทางเงินจริงจนกว่าการทดสอบผู้รับจริงและการตรวจค่าบริการ/เงื่อนไขผ่าน

## 2. [ปิดในโค้ดเฟส 1; ต้องดำเนินการ production] JWT รั่วผ่าน settings และผู้ชมสาธารณะได้รับข้อมูลเจ้าของ

- **ไฟล์/จุดที่พบก่อนแก้:** `Backend/server.js` handlers `update_goal`, `update_alert`, `update_top_donor`, `join_profile` และ broadcast เดิมในห้อง username; Dashboard ส่ง JWT มากับ settings
- **อาการก่อนแก้:** Settings handler เก็บ payload ทั้งก้อนรวม `token` ลง `goalSettings`/`alertSettings`/`topDonorSettings` แล้วส่งกลับห้องเดียวกับ Dashboard, Widget และ public donate page ผู้ชมที่อยู่ห้องเดียวกันจึงรับ JWT อายุ 7 วันผ่าน `apply_goal`/`apply_settings`/`apply_top_donor` และอาจใช้คำสั่งที่ตรวจ JWT เช่น `save_payment` เพื่อเปลี่ยนข้อมูลรับเงินได้ นอกจากนี้ donation broadcast ยังส่ง `update_history` และ `update_stats` ให้ผู้ชมในห้องเดียวกันด้วย
- **แนวทางแก้ที่ทำใน branch:** whitelist ฟิลด์ settings ตอนบันทึกและทุกครั้งที่ emit; แยกห้อง owner/widget/public; ส่ง history/stats เฉพาะ owner, alerts เฉพาะ widget และ leaderboard ตามการใช้งาน; ปฏิเสธ widget join ที่ใช้ username อย่างเดียว; server ต้องมี `JWT_SECRET` จาก environment
- **เหตุผล:** token เป็น credential การส่งออกเพียงครั้งเดียวก็เปิดสิทธิ์เปลี่ยนการตั้งค่าบัญชีจนกว่า token หมดอายุหรือ secret ถูกเปลี่ยน
- **ข้อดี:** ปิดเส้นทางรั่วทั้งข้อมูลเดิมใน settings และข้อมูลที่เกิดใหม่; ขอบเขต Socket แต่ละประเภทตรวจสอบได้
- **ข้อเสีย/ต้นทุน:** เปลี่ยน secret ทำให้ผู้ใช้ต้อง login ใหม่; ต้องตั้งค่า secret ใหม่บน Render และล้าง token ที่ค้างอยู่ในฐานข้อมูลหลังสำรองข้อมูล
- **ความมั่นใจ:** สูงมาก — Dashboard ส่ง token ใน payload, handlers เดิมเก็บทั้งก้อน และ broadcast เดิมส่งเข้า shared room
- **สถานะ:** โค้ดปิดการเก็บ/ส่ง token และแยกห้องแล้ว; เพิ่ม `scripts/scrub-legacy-setting-tokens.js` ซึ่ง dry-run เป็นค่าเริ่มต้น แต่ยังไม่ได้รันกับ production เพราะต้องสำรองฐานข้อมูลก่อน และยังไม่ได้หมุน secret บน Render

## 3. [ปิดในโค้ดเฟส 1] ชื่อ/ข้อความผู้โดเนทแทรก HTML/JavaScript ใน Dashboard และ Overlay อันดับ

- **ไฟล์/จุดที่พบก่อนแก้:** `Frontendd/dashboard.html` ประวัติ donation; `Frontendd/top-donator.html` leaderboard; ข้อมูลผู้โดเนทมาจาก `Backend/server.js` handler `new_donation`
- **อาการปัจจุบัน:** Dashboard ประกอบ `innerHTML` จาก `item.name`, `item.message`, `item.imageUrl`; Overlay อันดับประกอบ `innerHTML` จาก `donator.name` ข้อมูลส่วนนี้มาจากผู้ส่ง donation โดยตรง จึงใส่ markup/event handler เพื่อรันสคริปต์ใน browser ของผู้ดู dashboard หรือ overlay ได้
- **แนวทางแก้ที่ทำ:** สร้าง element ด้วย DOM API และใส่ donor name/message ผ่าน `textContent`; ลิงก์รูปใน Dashboard รับเฉพาะ HTTPS และใช้ `rel="noopener noreferrer"`
- **เหตุผลที่แนะนำ:** การ escape ที่จุด render ครอบคลุมการแสดงผลทุกกรณี แม้ข้อมูลเดิมในฐานข้อมูลยังมี markup
- **ข้อดี:** ป้องกัน stored XSS ในหน้าที่แสดงประวัติ/อันดับ
- **ข้อเสีย/ต้นทุน:** markup สำหรับประวัติและอันดับต้องสร้างเป็น element แยก
- **ความมั่นใจ:** สูงมาก — ก่อนแก้ข้อมูลถูก interpolate ลง `innerHTML` โดยตรง; ทดสอบกรณี `<img onerror>` แล้วแสดงเป็นข้อความผ่าน jsdom
- **สถานะ:** แก้แล้วในโค้ด branch นี้; ยังไม่ได้ deploy production

## 4. [ปิดในโค้ดเฟส 1] ใครก็เข้าฟัง Alert ของ streamer ได้ด้วยชื่อผู้ใช้แทน Widget token

- **ไฟล์/จุดที่พบก่อนแก้:** `Backend/server.js` handler `join_widget`; `Frontendd/widget.html` ส่งข้อมูลเชื่อมต่อ
- **อาการปัจจุบัน:** `join_widget` มี fallback ค้นผู้ใช้ด้วย username และให้ socket เข้าห้องเดียวกับ streamer แม้ token ว่างหรือไม่ถูกต้อง ถ้าทราบ username ก็รับ `show_alert` และข้อมูล leaderboard ได้ เมื่อรวมกับข้อ 2 ยังรับ history/stats จาก broadcast ห้องนั้นด้วย
- **แนวทางแก้:** บังคับใช้ widget token ที่สุ่มและตรวจตรงกับบัญชีเสมอ; ปฏิเสธการ join เมื่อ token ไม่มี/ผิด และแยกห้องข้อมูลสาธารณะตามความจำเป็น
- **เหตุผลที่แนะนำ:** Username เป็นข้อมูลที่เดา/เผยแพร่ได้ ไม่ใช่ข้อมูลลับสำหรับควบคุมสิทธิ์
- **ข้อดี:** จำกัดผู้รับข้อมูลของ overlay ให้เป็นผู้ถือ URL/token ที่ streamer ออกให้
- **ข้อเสีย/ต้นทุน:** ลิงก์ widget แบบ username อย่างเดียวใช้ไม่ได้; URL แบบมี token เดิมยังใช้ได้จนกว่าจะหมุน `widgetToken`
- **ความมั่นใจ:** สูงมาก — fallback ถูกลบและเทสต์ยืนยันว่า username อย่างเดียวถูกปฏิเสธ
- **สถานะ:** แก้แล้วในโค้ด branch นี้; ยังไม่ได้ deploy production

## 5. [ปิดในโค้ดเฟส 1] ลิงก์ Social ที่ streamer กรอกสามารถใช้ `javascript:` ได้

- **ไฟล์/จุดที่พบ:** `Backend/server.js` บรรทัด 537–550; `Frontendd/donate.html` บรรทัด 347–374
- **อาการปัจจุบัน:** Server บันทึก URL ที่รับมาโดยไม่ตรวจ scheme และหน้า public กำหนดค่าให้ `href` โดยตรง ลิงก์ `javascript:` ที่ผู้ใช้คลิกอาจรันโค้ดในบริบทหน้าเว็บ
- **แนวทางแก้ที่ทำ:** server รับเฉพาะ URL `https:` ตอนบันทึก และหน้า donate ตรวจ scheme ซ้ำก่อนกำหนด `href`
- **เหตุผลที่แนะนำ:** การตรวจทั้งฝั่ง server และจุดแสดงผลกันข้อมูลเดิม/ข้อมูลที่บันทึกจาก client รุ่นเก่า
- **ข้อดี:** ป้องกันลิงก์อันตรายจากบัญชี streamer ที่ถูกยึดหรือข้อมูลนำเข้า
- **ข้อเสีย/ต้นทุน:** URL รูปแบบอื่นที่เคยยอมรับจะต้องแก้ให้เป็นลิงก์เว็บมาตรฐาน
- **ความมั่นใจ:** สูง — ก่อนแก้ค่า `href` มาจากข้อมูลที่ผู้ใช้บันทึกโดยตรง; เพิ่มเทสต์ `javascript:` และ `data:` ถูกปฏิเสธ
- **สถานะ:** แก้แล้วในโค้ด branch นี้; ยังไม่ได้ deploy production

## 6. [สูง] สถิติ “วันนี้” ไม่เปลี่ยนวันและการลบรายการปรับยอดวันนี้ผิด

- **ไฟล์/จุดที่พบ:** `Backend/server.js` ฟิลด์ `stats.today`, handler `new_donation`, `delete_donation`
- **อาการปัจจุบัน:** `stats.today` เพิ่มทุก donation แต่ไม่มี logic เปลี่ยนวันหรือคำนวณจากวันที่ของรายการ เมื่อข้ามวันยอดยังรวมวันเก่า และเมื่อลบ donation เก่าก็หักจากยอดวันนี้ด้วย ทำให้การ์ด “ยอดโดเนทวันนี้” ไม่ตรงความหมาย
- **แนวทางแก้:** คำนวณยอดวันนี้จากรายการที่อยู่ในวันปัจจุบัน/เขตเวลาที่กำหนด หรือใช้ daily aggregate ที่มีวันกำกับและเปลี่ยนวันอย่างชัดเจน; ตอนลบให้ปรับเฉพาะวันของรายการนั้น
- **เหตุผลที่แนะนำ:** การ derive จากวันที่จริงลดความผิดพลาดจากการที่ process ไม่ได้ทำงานตอนเที่ยงคืน
- **ข้อดี:** ยอดวันนี้ถูกต้องหลังข้ามวัน ลบข้อมูล หรือ restart server
- **ข้อเสีย/ต้นทุน:** ต้องกำหนดเขตเวลาและอาจเพิ่มต้นทุน query/aggregate หรือ migration ข้อมูลเก่า
- **ความมั่นใจ:** สูงมาก — ไม่มีจุด reset ตามวันใน logic ที่สำรวจ และการลบหัก `today` ทุกครั้ง
- **สถานะ:** ยังไม่แก้; วางไว้ในเฟส 3 พร้อม migration

## 7. [ยังค้าง — migration เฟส 3] ประวัติเดิมที่ฝังใน User ยังโตไม่จำกัด

- **ไฟล์/จุดที่พบ:** `Backend/server.js` Schema `User.history`, handler `new_donation`, `emitDashboardData`
- **อาการปัจจุบัน:** ทุก donation เพิ่มลงอาร์เรย์ `history` ใน document เดียว และทุกครั้งโหลด/ส่ง/บันทึกประวัติทั้งหมด ไม่มีการจำกัดจำนวนหรือแบ่งเก็บ เมื่อ document โตเกินขีดจำกัด BSON ของ MongoDB การ save จะล้มเหลว ทำให้ donation ใหม่และการแก้ข้อมูลผู้ใช้อาจล้มเหลวไปด้วย ก่อนถึงจุดนั้น payload และการอ่านเขียนก็ใหญ่ขึ้นเรื่อย ๆ
- **แนวทางแก้:** เพิ่ม `Donation` collection และ index สำหรับรายการใหม่แล้ว; ขั้นต่อไปต้องย้าย history เก่าแบบ idempotent, เปลี่ยน Dashboard ให้อ่านแบบแบ่งหน้า/จาก collection, ปรับ aggregate สถิติ/อันดับ แล้วค่อยหยุด mirror ลง `User.history`
- **เหตุผลที่แนะนำ:** ประวัติเป็นข้อมูลที่เพิ่มต่อเนื่องและไม่ควรผูกกับขนาด document บัญชี
- **ข้อดี:** ไม่ชนขนาด document, โหลดหน้าประวัติได้เร็วขึ้น และลบ/ค้นข้อมูลเป็นรายการได้ตรงตัว
- **ข้อเสีย/ต้นทุน:** ต้อง migrate ประวัติเดิมและปรับ query, การคำนวณ aggregate, reset/delete และการ broadcast
- **ความมั่นใจ:** สูง — โครงสร้างเป็น embedded array และไม่มีการจำกัด/แบ่งหน้าในเส้นทางที่ตรวจ
- **สถานะ:** แก้บางส่วน — รายการ pending/confirmed/test ใหม่เก็บใน `Donation`, แต่รายการ confirmed ยัง mirror ใน `User.history` เพื่อให้หน้าปัจจุบันทำงานและประวัติเก่ายังไม่ได้ย้าย; จึงยังมีข้อจำกัด document size จนกว่าจะทำ migration

## 8. [แก้ในโค้ด; ต้องตั้งค่า production] การยืนยันตัวตนเคยใช้ JWT secret ค่า fallback ที่ฝังในซอร์ส

- **ไฟล์/จุดที่พบ:** `Backend/server.js` บรรทัด 15; `Backend/server.js` บรรทัด 102–109, 169–174
- **อาการก่อนแก้:** หากไม่ได้กำหนด `JWT_SECRET` ระบบใช้ค่าคงที่ใน repository
- **แนวทางแก้ที่ทำ:** server หยุดเริ่มพร้อมข้อความชัดเจนเมื่อไม่มี `JWT_SECRET`
- **เหตุผลที่แนะนำ:** fallback คงที่ทำให้ความลับหมดความหมายเมื่อโค้ดถูกเผยแพร่
- **ข้อดี:** ป้องกันการปลอม JWT จากค่าที่คาดเดาได้ และลดโอกาส deploy ผิดค่าตั้งต้น
- **ข้อเสีย/ต้นทุน:** ต้องตั้งค่าตอนรันทุก environment; การเปลี่ยน secret ทำให้ session เดิมหมดอายุ
- **ความมั่นใจ:** สูงมาก — fallback เดิมถูกลบ; เพิ่มเทสต์ยืนยันว่า server ไม่เริ่มเมื่อไม่มี secret
- **สถานะ:** โค้ดแก้แล้ว แต่ต้องตั้ง secret ใหม่ใน Render ก่อน deploy และยอมรับว่าผู้ใช้ต้อง login ใหม่

## 9. [ค้าง — เฟส 4] Production dependencies มี security advisories

- **ไฟล์/จุดที่พบ:** `Backend/package-lock.json`; ผล `npm audit --prefix Backend --omit=dev`
- **อาการปัจจุบัน:** audit รายงาน 7 advisories ใน production dependency (1 critical, 5 high, 1 moderate) รวม `proxy-addr`, `body-parser`, `engine.io`, `path-to-regexp`, `socket.io-parser` และ `ws`; หลายรายการเป็น denial of service และหนึ่งรายการเป็น IP spoofing ใน proxy address handling
- **แนวทางแก้:** อัปเดต dependency ไปเวอร์ชันที่ audit ระบุว่าแก้แล้ว และรัน integration tests/ตรวจการทำงานของ Express กับ Socket.IO หลังอัปเดต
- **เหตุผล:** เวอร์ชันปัจจุบันใน lockfile อยู่ในช่วงที่มี advisory; ต้องรักษา dependency production ให้ได้รับแพตช์
- **ข้อดี:** ลดความเสี่ยงจากแพ็กเกจที่มีช่องโหว่ที่ทราบแล้ว
- **ข้อเสีย/ต้นทุน:** การอัปเดตอาจเปลี่ยนพฤติกรรม/compatibility ต้องตรวจและทดสอบก่อน deploy
- **ความมั่นใจ:** สูง — `npm audit --omit=dev` ตรวจ lockfile และระบุแพ็กเกจที่ได้รับผล
- **สถานะ:** ยังไม่อัปเดต; จัดไว้ในเฟส 4 ตามแผน hardening

## หมายเหตุ

- `Frontendd/main.js` มีขนาด 0 bytes; ยังไม่พบหลักฐานว่าหน้าใดโหลดไฟล์นี้ จึงไม่จัดเป็นบัคที่มีผลต่อการทำงาน
- เทสต์ integration 8 รายการผ่าน: token ไม่ถูกเก็บ/ส่ง, public socket ไม่รับ history/stats/goal/alert, event `new_donation` ปลอมไม่เพิ่มยอด, สลิป mock ที่บัญชี/ยอดผ่านยืนยันได้ครั้งเดียว, ผู้รับผิดและ slip reference ซ้ำไม่เพิ่มยอด, test donation ลง log/ส่ง alert โดยไม่เพิ่มยอด/Goal, widget username fallback ถูกปฏิเสธ, XSS แสดงเป็นข้อความ และ server บังคับ `JWT_SECRET`
- `npm audit --prefix Backend --omit=dev` พบ 7 vulnerabilities ใน production dependencies; ยังไม่รัน `npm audit fix`
- เทสต์ใช้ MongoDB ชั่วคราว; ยังไม่ได้ตรวจ/แก้ MongoDB production หรือ Render และยังไม่ได้ deploy
- งานถัดไปก่อน production rollout: ทำและตรวจ backup → ตั้ง secret ใหม่บน Render → ตรวจ dry-run ของ scrub script → รัน scrub หลังยืนยัน backup → deploy branch นี้และตรวจ login/widget links
- ก่อนเปิดเงินจริง: ทดสอบ `EASYSLIP_API_KEY` และยืนยันการสมัคร/ลงทะเบียนบัญชีผู้รับ streamer หลายคนใน EasySlip; สำรองฐานข้อมูล, เปลี่ยน JWT secret และ scrub token เก่าตามขั้นตอนด้านบน; โค้ดชุดนี้ยังไม่ deploy
- งานค้าง: ย้าย history ฝังใน User แบบ idempotent และแก้สถิติวันนี้/ลบตามรายการ; เฟส 4 hardening และอัปเดต dependency ตาม advisory

## 10. [แก้ไขเพิ่มเติม] ตั้งค่าช่องทางรับเงินแล้วไม่ปรากฏหน้า Donate
- **อาการที่ยืนยันจาก production:** หน้า `/donate.html?u=OceanMaDiWa` แสดงเฉพาะ Test Donation และข้อความปิดรับเงินจริง
- **สาเหตุในโค้ด:** Public payment settings จะปิด PromptPay และ Bank Transfer หากบัญชีผู้รับยังไม่มี `verifiedAccountId`; การ Save ธนาคารลงทะเบียนบัญชีกับ EasySlip และ error ทุกชนิดเคยถูกแสดงผิดเป็น “ตรวจสอบสลิปไม่สำเร็จ”
- **แนวทางแก้:** แยกข้อความข้อผิดพลาดตาม endpoint/provider code และถ้า EasySlip แจ้งบัญชีซ้ำ ให้ค้นหาบัญชีที่ตรงกันแล้วเชื่อมเข้ากับ branch; เพิ่มคำอธิบายว่าต้องลงทะเบียนผู้รับสำเร็จก่อนเปิดเงินจริง
- **ข้อจำกัด:** ยังไม่ทราบ error code จริงจาก EasySlip ในบัญชี production; ต้อง deploy แล้วลองบันทึกใหม่เพื่อรับข้อความระบุสาเหตุ หากยังล้มเหลวให้ตรวจ error code และรายละเอียดจากหน้าตั้งค่า/Render log โดยไม่ส่ง API key
