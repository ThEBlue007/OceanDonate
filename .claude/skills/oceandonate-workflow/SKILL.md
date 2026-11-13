---
name: oceandonate-workflow
description: Workflow for working on the OceanDonate project (Express + Socket.io + MongoDB donation site with a streamer dashboard, donate page and OBS widgets). Use this skill at the start of EVERY task in this repo - fixing bugs, adding features, refactoring, reviewing security, editing Backend/server.js or any file in Frontendd/ (dashboard.html, donate.html, widget.html, goal.html, top-donator.html, auth.html). It makes Claude read List.md first and update List.md whenever logic or methods change. Trigger even for small edits, and whenever the user mentions OceanDonate, List.md, donate, dashboard, widget, alert, goal, top donator, or streamer.
---

# OceanDonate Workflow

โปรเจกต์นี้มีไฟล์แผนที่โค้ดชื่อ `List.md` อยู่ที่ root ของ repo ใช้เป็นจุดเริ่มต้นและบันทึกการเปลี่ยนแปลงทุกครั้ง

## 1. ก่อนเริ่มงาน (ห้ามข้าม)

1. อ่าน `List.md` ทั้งไฟล์ก่อนเขียนหรือแก้โค้ดใด ๆ
2. ถ้าไม่มี `List.md`: สำรวจโค้ดทั้งโปรเจกต์ (ข้าม `node_modules/`, `.git/`) แล้วสร้างไฟล์ตามโครงสร้างในหัวข้อ 4 ก่อน จากนั้นค่อยเริ่มงาน
3. ถ้า `List.md` ขัดกับโค้ดจริง ให้เชื่อโค้ดจริง แล้วแก้ `List.md` ให้ตรง (บันทึกใน Change Log ด้วย)
4. สรุปแผนสั้น ๆ ให้ผู้ใช้ก่อนลงมือ: จะแก้ไฟล์ไหน และกระทบส่วนไหนของ List.md

## 2. ระหว่างทำงาน — กติกาของโปรเจกต์นี้

- โฟลเดอร์ Frontend สะกดว่า `Frontendd` (2 ตัว d) อย่าเปลี่ยนชื่อ เพราะ `Backend/server.js` ชี้ path นี้ (`express.static`)
- Backend อยู่ไฟล์เดียว `Backend/server.js` ถ้าจะแตกไฟล์ ให้ถามผู้ใช้ก่อน
- Socket event ฝั่งสตรีมเมอร์ทุกตัวต้องเรียก `checkAuth(data)` ก่อนแตะฐานข้อมูล event ใหม่ที่ไม่เรียก ถือว่าไม่ผ่าน
- ห้ามใส่ข้อความที่ผู้โดเนทกรอก (`name`, `message`, `imageUrl`) ลง `innerHTML` โดยไม่ escape ให้ใช้ `textContent`/`innerText` หรือฟังก์ชัน escape
- ห้ามบันทึก `token` หรือ object `data` ทั้งก้อนที่ client ส่งมาลงฐานข้อมูล ให้เลือกเก็บเฉพาะฟิลด์ที่ต้องการ
- ห้ามฝัง secret ในโค้ด (`JWT_SECRET`, connection string) ใช้ตัวแปรสภาพแวดล้อม
- ข้อความที่ผู้ใช้เห็นเป็นภาษาไทยเป็นหลัก หน้า donate/auth/dashboard/index มีสลับ TH/EN ด้วย attribute `data-th` / `data-en` (class `lang-el`) ถ้าเพิ่มข้อความใหม่ ให้ใส่ทั้งสองภาษา
- แก้เท่าที่ผู้ใช้ขอ อย่าแตะส่วนอื่นที่ไม่เกี่ยว ถ้าเจอปัญหาอื่นระหว่างทางให้รายงานแทนการแก้เงียบ ๆ (ปัญหาที่รู้แล้วอยู่ใน `List.md` หัวข้อ "ข้อสังเกต / ความเสี่ยง")

## 3. หลังแก้ (ห้ามข้าม)

เมื่อแก้ **Logic หรือวิธีการทำงาน** (API, Socket event, Schema, ขั้นตอนโดเนท, คิวแจ้งเตือน, auth, การคำนวณ ฯลฯ) ต้องอัปเดต `List.md` ในงานเดียวกัน:

1. แก้หัวข้อที่เกี่ยวข้องให้ตรงกับพฤติกรรมใหม่ (ตาราง API/Socket, Logic หลัก, Schema, โครงสร้างไฟล์)
2. ถ้าแก้ปัญหาที่อยู่ในหัวข้อ "ข้อสังเกต / ความเสี่ยง" ให้ลบหรือย้ายรายการนั้นออก
3. เพิ่มแถวใน **Change Log** ท้ายไฟล์: วันที่ | ไฟล์ | สิ่งที่เปลี่ยน | เหตุผล
4. เขียนให้คนอ่านเข้าใจง่าย: สั้น ตรงประเด็น อธิบายว่า "ทำงานอย่างไร" ไม่ต้องวางโค้ดยาว

การแก้ที่ไม่กระทบ Logic (สี, ข้อความ, CSS) ไม่ต้องอัปเดตหัวข้อ Logic แต่ถ้าเพิ่ม/ลบไฟล์ ให้อัปเดตโครงสร้างไฟล์

ท้ายงาน ให้บอกผู้ใช้ว่าแก้ไฟล์ไหนบ้างและอัปเดตส่วนไหนของ `List.md` และถ้ายังไม่ได้ทดสอบจริง ให้บอกตรง ๆ ว่ายังไม่ได้รัน

## 4. โครงสร้างของ List.md (ใช้ตอนสร้างใหม่หรือจัดระเบียบ)

1. เทคโนโลยีที่ใช้
2. โครงสร้างโฟลเดอร์ (ทุกไฟล์พร้อมหน้าที่ 1 บรรทัด)
3. วิธีรัน และตัวแปรสภาพแวดล้อม
4. ฐานข้อมูล (Schema)
5. REST API (ตาราง: Method + Path | หน้าที่)
6. Socket.io Events (Client→Server พร้อมวิธีตรวจสิทธิ์ และ Server→Client)
7. Logic หลัก (โดเนท, Top Donators, หน้าโดเนท, Dashboard, Widget)
8. ข้อสังเกต / ความเสี่ยงที่พบ (ยังไม่แก้)
9. สิ่งที่สำรวจจริง / ยังไม่ได้ลงลึก (บอกตรง ๆ ว่าอ่านส่วนไหนไม่ครบ)
10. Change Log

## 5. ข้อควรระวังเฉพาะโปรเจกต์ (ควรรู้ตั้งแต่ต้น)

- ปุ่ม "จำลองว่าโอนสำเร็จแล้ว" (`successMockup()` ใน `donate.html`) ส่ง `new_donation` โดยไม่ตรวจการชำระเงินจริง อย่าถือว่ายอดโดเนทถูกยืนยันแล้ว
- ห้องของสตรีมเมอร์ใน Socket.io ใช้ชื่อ `username` ร่วมกันทั้ง Dashboard, Widget และหน้าโดเนทสาธารณะ ข้อมูลที่ `io.to(username).emit(...)` จะถึงทุกคนในห้อง ระวังไม่ให้ข้อมูลส่วนตัว (เช่น ประวัติโดเนทเต็ม) รั่วถึงผู้เข้าชมสาธารณะ
- `history` ถูกฝังใน document ของผู้ใช้ (โตไม่จำกัด) และ `delete_donation` อ้างตาม index ของอาร์เรย์
