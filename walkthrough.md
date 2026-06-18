# Walkthrough: Telegram-First Standalone Maintenance System

ระบบ **Telegram-First Standalone Maintenance System** ได้รับการพัฒนาและสร้างไฟล์ที่จำเป็นทั้งหมดครบถ้วนตามข้อกำหนด 3B Hybrid Model (Google Sheets + GAS + Jamstack) แล้วครับ

## สิ่งที่ได้ดำเนินการ (Changes Made)

- **Backend (GAS):**
  - สร้างไฟล์ [backend/Config.js](backend/Config.js) เพื่อจัดการตัวแปรคงที่ เช่น `TELEGRAM_TOKEN`, `GEMINI_API_KEY`, `COMPANY_SECRET_CODE` เป็นต้น
  - สร้างไฟล์ [backend/Code.js](backend/Code.js) สำหรับเป็น Webhook รับคำสั่งจากทั้ง Telegram และ Web Frontend
  - 구현ระบบ **Gatekeeper**: เช็คสิทธิ์ด้วย Telegram Chat ID และระบบลงทะเบียนด้วยคำสั่ง `/register PTTEP2026 ชื่อ`
  - 구현ระบบ **AI Intent Classification**: ทำการส่งข้อความดิบให้ `gemini-2.0-flash` วิเคราะห์เจตนา (CREATE_JOB, LIST_PENDING_JOB, CLOSE_JOB, VIEW_REPORT)
  - 구현ระบบการจัดการงาน: สกัดข้อมูลการแจ้งซ่อมเป็น JSON, ค้นหางานค้าง, การเซฟรูปภาพลง Google Drive และให้ AI ช่วยปรับภาษาเมื่อมีการปิดงาน (CLOSE_JOB)

- **Frontend (Web Dashboard):**
  - สร้างหน้า [frontend/index.html](frontend/index.html) โดยใช้ Bootstrap 5 ดีไซน์สีกรมท่า-ขาว สไตล์วิศวกรรม
  - ฝังระบบ Google Identity Services (SSO) เพื่อล็อกอินและดึงอีเมล
  - ทำการ Request ข้อมูลผ่าน Webhook (`doPost`) โดยจำกัดสิทธิ์เฉพาะอีเมลที่มีในชีต `Admins` หรือ `Technicians` เท่านั้น
  - แสดงผลสถิติ, Master Job List, และแกลเลอรีรูปภาพผลงาน

- **Documentation (Setup Guide):**
  - สร้างไฟล์ [README.md](README.md) อธิบายขั้นตอนการตั้งค่า (Telegram Bot, Google Apps Script, Google Drive API, Webhook, และ GitHub Pages) อย่างละเอียดทีละขั้นตอน

## การตรวจสอบความถูกต้อง (Validation)
เนื่องจากระบบพึ่งพาแพลตฟอร์ม Google Apps Script (GAS) ซึ่งไม่สามารถรันและจำลองการเชื่อมต่อ Database ในเครื่อง (Local) ได้โดยตรง โค้ดทั้งหมดจึงถูกเขียนให้อยู่ในโครงสร้างมาตรฐานของ GAS:
- โค้ดมีการทำ Error Handling รัดกุมในจุดที่เชื่อมต่อกับ API (Gemini, Telegram)
- การดึงข้อมูลแผ่นงาน `SpreadsheetApp` และล็อกด้วย `LockService.getScriptLock()` ป้องกันข้อมูลชนกัน
- การใช้ `UrlFetchApp` สำหรับการเรียก External API (Telegram, Gemini) ถูกต้องตามมาตรฐาน

## ขั้นตอนต่อไปสำหรับคุณ (Next Steps)
คุณสามารถนำไฟล์ทั้งหมดไปเริ่มต้นใช้งานได้ทันที โดยเปิดอ่านคำแนะนำแบบละเอียดในไฟล์ [README.md](README.md) ได้เลยครับ 

> [!TIP]
> หากพบปัญหาในเรื่องของการทดสอบระบบบนเครื่อง Local อย่าลืมตรวจสอบการตั้งค่า CORS (Cross-Origin Resource Sharing) ในฝั่ง GAS เวลาดึงข้อมูลผ่านหน้าเว็บ หากใช้วิธี Deploy แบบ Standalone อาจจะต้องใช้การตั้งค่า `mode: 'no-cors'` หรือพิจารณาการส่งคืนผลลัพธ์เป็น JSONP หากเกิดข้อจำกัดในเบราว์เซอร์
