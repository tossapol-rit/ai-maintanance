// ==========================================
// Code.js - Backend Logic สำหรับ Google Apps Script (GAS)
// Telegram-First Standalone Maintenance System
// ==========================================

// โหลด Spreadsheet
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

// ---------------------------------------------------------
// HTTP POST Request Handler
// ---------------------------------------------------------
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // ป้องกันข้อมูลชนกัน รอสูงสุด 10 วินาที

  try {
    var postData = JSON.parse(e.postData.contents);

    // ตรวจสอบว่าเป็น Request จาก Web Frontend หรือ Telegram
    if (postData.source === 'web_frontend') {
      var result = handleWebRequest(postData);
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    } else if (postData.message) {
      // Request จาก Telegram Bot
      handleTelegramMessage(postData.message);
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "ignored" })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error("Error in doPost: " + err.message);
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.message })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------
// Web Frontend Handler (Access Control)
// ---------------------------------------------------------
function handleWebRequest(postData) {
  var email = postData.email;
  if (!email) {
    return { status: "error", message: "No email provided" };
  }

  var ss = getSpreadsheet();
  var adminsSheet = ss.getSheetByName("Admins");
  var techsSheet = ss.getSheetByName("Technicians");

  var adminData = adminsSheet.getDataRange().getValues();
  var techData = techsSheet.getDataRange().getValues();

  var hasAccess = false;
  var role = "";

  // Check Admin (Column index 2 is Google_Email)
  for (var i = 1; i < adminData.length; i++) {
    if (adminData[i][2] === email) {
      hasAccess = true;
      role = "admin";
      break;
    }
  }

  // Check Technician (Column index 2 is Google_Email)
  if (!hasAccess) {
    for (var j = 1; j < techData.length; j++) {
      if (techData[j][2] === email) {
        hasAccess = true;
        role = "technician";
        break;
      }
    }
  }

  if (!hasAccess) {
    return { status: "denied", message: "Access Denied. Email not authorized." };
  }

  // ถ้ามีสิทธิ์ ให้ดึงข้อมูลงานทั้งหมด
  var jobsSheet = ss.getSheetByName("Jobs");
  var jobsData = jobsSheet.getDataRange().getValues();
  var headers = jobsData[0];
  var jobsList = [];

  for (var k = 1; k < jobsData.length; k++) {
    var jobObj = {};
    for (var h = 0; h < headers.length; h++) {
      jobObj[headers[h]] = jobsData[k][h];
    }
    jobsList.push(jobObj);
  }

  return { status: "success", role: role, data: jobsList };
}

// ---------------------------------------------------------
// Telegram Bot Handler
// ---------------------------------------------------------
function handleTelegramMessage(message) {
  var chatId = message.chat.id.toString();
  var text = message.text || "";
  var photo = message.photo || null; // กรณีมีการส่งรูปภาพ
  var caption = message.caption || ""; // ข้อความที่มาพร้อมรูปภาพ

  // ถ้าเป็นการส่งรูป ให้ใช้ caption เป็น text
  if (photo && !text) {
    text = caption;
  }

  if (!text) return; // ไม่มีข้อความให้ข้ามไป

  var ss = getSpreadsheet();
  var techsSheet = ss.getSheetByName("Technicians");
  var adminsSheet = ss.getSheetByName("Admins");
  
  var techData = techsSheet.getDataRange().getValues();
  var adminData = adminsSheet.getDataRange().getValues();

  // 1. ระบบ Gatekeeper: ตรวจสอบสถานะผู้ใช้ (Boss, Admin, Technician)
  var isBoss = (chatId === BOSS_TELEGRAM_CHAT_ID);
  var isAdmin = false;
  var isTechnician = false;
  var techId = null;
  var techName = null;
  var adminName = "Admin";

  // ตรวจสอบ Admin (เพิ่มคอลัมน์ Telegram_Chat_ID เข้าไปที่ Column D หรือ index 3 ของชีต Admins)
  for (var a = 1; a < adminData.length; a++) {
    if (adminData[a][3] && adminData[a][3].toString() === chatId) {
      isAdmin = true;
      adminName = adminData[a][1]; // เก็บชื่อแอดมินไว้ใช้งาน
      break;
    }
  }

  // ตรวจสอบ Technician
  for (var i = 1; i < techData.length; i++) {
    if (techData[i][3] && techData[i][3].toString() === chatId) {
      isTechnician = true;
      techId = techData[i][0];
      techName = techData[i][1];
      break;
    }
  }
  
  var roleContext = "คนนอก";
  if (isBoss) roleContext = "ผู้บริหาร (Boss)";
  else if (isAdmin) roleContext = "แอดมิน (Admin / คนคีย์ข้อมูล)";
  else if (isTechnician) roleContext = "ช่างซ่อมบำรุงหน้างาน (Technician)";

  // กรณีเป็นคำสั่งลงทะเบียน: /register [รหัสลับ] [ชื่อพนักงาน]
  if (text.startsWith("/register")) {
    if (isTechnician) {
      sendTelegramMessage(chatId, "ท่านได้ลงทะเบียนในระบบเรียบร้อยแล้ว");
      return;
    }

    var parts = text.split(" ");
    if (parts.length >= 3) {
      var secret = parts[1];
      var name = parts.slice(2).join(" ");

      if (secret === COMPANY_SECRET_CODE) {
        var newTechId = "TECH-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmm");
        // [Tech_ID, Name, Google_Email, Telegram_Chat_ID, Status]
        techsSheet.appendRow([newTechId, name, "", chatId, "Active"]);
        sendTelegramMessage(chatId, "ลงทะเบียนสำเร็จ! รหัสช่างของคุณคือ: " + newTechId);
      } else {
        sendTelegramMessage(chatId, "รหัสลับบริษัทไม่ถูกต้อง การลงทะเบียนถูกปฏิเสธ");
      }
    } else {
      sendTelegramMessage(chatId, "รูปแบบคำสั่งไม่ถูกต้อง กรุณาพิมพ์: /register [รหัสลับ] [ชื่อ-นามสกุล]");
    }
    return;
  }

  if (!isTechnician && !isBoss && !isAdmin) {
    sendTelegramMessage(chatId, "❌ คุณไม่มีสิทธิ์เข้าใช้งานระบบ กรุณาติดต่อแอดมิน หรือลงทะเบียนผ่านคำสั่ง /register");
    return;
  }

  // Check PropertiesService for conversational state
  var props = PropertiesService.getScriptProperties();
  var userState = props.getProperty("STATE_" + chatId);
  
  if (userState === "WAITING_JOB_DETAILS") {
    // If we are waiting for details, route back to handleCreateJob
    handleCreateJob(chatId, text, true, photo);
    return;
  }

  // 2. ส่งข้อความดิบให้ Gemini แยกเจตนา (Intent Classification) พร้อมส่งบริบท Role (หน้าที่) ไปให้ AI รู้
  var intent = classifyIntent(text, roleContext);

  // 3. นำ Intent มาตรวจสอบไขว้กับรหัสและสิทธิ์
  switch (intent) {
    case "VIEW_REPORT":
      handleViewReport(chatId, isBoss);
      break;
    case "CREATE_JOB":
      // ให้ Boss หรือ Admin ทำได้
      if (isBoss || isAdmin) {
        handleCreateJob(chatId, text, false, photo);
      } else {
        sendTelegramMessage(chatId, "❌ เฉพาะสิทธิ์ Admin/Boss เท่านั้นที่สามารถแจ้งงานใหม่ได้");
      }
      break;
    case "ASSIGN_JOB":
      // ให้ Boss หรือ Admin ทำได้
      if (isBoss || isAdmin) {
        var actor = isBoss ? "ผู้บริหาร" : adminName;
        handleAssignJob(chatId, text, actor);
      } else {
        sendTelegramMessage(chatId, "❌ เฉพาะสิทธิ์ Admin/Boss เท่านั้นที่สามารถแจกงานได้");
      }
      break;
    case "LIST_PENDING_JOB":
      if (isTechnician) {
        handleListPendingJob(chatId, techId);
      } else {
        sendTelegramMessage(chatId, "❌ เฉพาะช่างซ่อมบำรุงเท่านั้นที่สามารถดูงานค้างได้");
      }
      break;
    case "CLOSE_JOB":
      if (isTechnician) {
        handleCloseJob(chatId, techId, techName, text, photo);
      } else {
        sendTelegramMessage(chatId, "❌ เฉพาะช่างซ่อมบำรุงเท่านั้นที่สามารถปิดงานได้");
      }
      break;
    case "CHECK_TECH_WORKLOAD":
      if (isBoss || isAdmin) handleCheckWorkload(chatId);
      else sendTelegramMessage(chatId, "❌ เฉพาะสิทธิ์ Admin/Boss เท่านั้น");
      break;
    case "LIST_UNASSIGNED_JOB":
      if (isBoss || isAdmin) handleListUnassignedJob(chatId);
      else sendTelegramMessage(chatId, "❌ เฉพาะสิทธิ์ Admin/Boss เท่านั้น");
      break;
    case "LIST_ALL_PENDING_JOB":
      if (isBoss || isAdmin) handleListAllPendingJob(chatId);
      else sendTelegramMessage(chatId, "❌ เฉพาะสิทธิ์ Admin/Boss เท่านั้น");
      break;
    case "VIEW_JOB_DETAIL":
      if (isBoss || isAdmin) handleViewJobDetail(chatId, text);
      else sendTelegramMessage(chatId, "❌ เฉพาะสิทธิ์ Admin/Boss เท่านั้น");
      break;
    case "CANCEL_JOB":
      if (isBoss || isAdmin) {
        var actor = isBoss ? "ผู้บริหาร" : adminName;
        handleCancelJob(chatId, text, actor);
      } else {
        sendTelegramMessage(chatId, "❌ เฉพาะสิทธิ์ Admin/Boss เท่านั้นที่สามารถยกเลิกงานได้");
      }
      break;
    case "VIEW_SLA_REPORT":
      handleSlaReport(chatId, isBoss);
      break;
    case "UNKNOWN":
    default:
      sendTelegramMessage(chatId, "🤖 ผมไม่เข้าใจคำสั่งของคุณครับ (Intent: UNKNOWN)\nกรุณาลองใหม่อีกครั้ง เช่น ขอดูงานค้าง, ขอรายงานสรุป, หรือ ปิดงาน JOB-123");
      break;
  }
}

// ---------------------------------------------------------
// Intent Classification with Gemini 2.0 Flash
// ---------------------------------------------------------
function classifyIntent(text, roleContext) {
  var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GEMINI_API_KEY;
  var prompt = "คุณคือ AI วิเคราะห์เจตนาของระบบ Maintenance (Telegram Bot) ผู้ที่กำลังพิมพ์หาคุณคือ: [" + roleContext + "]\n" +
               "วิเคราะห์ข้อความต่อไปนี้และจัดหมวดหมู่เจตนาให้ถูกต้อง ตอบกลับมาเป็นรหัสสั้นๆ คำเดียวเท่านั้น ห้ามมีคำอธิบายเพิ่มเติม เลือกจากรายการนี้:\n" +
               "- CREATE_JOB (สำหรับแจ้งงานซ่อมใหม่ มักมาจาก Admin/Boss)\n" +
               "- ASSIGN_JOB (สำหรับแจกงานหรือเปลี่ยนมือช่าง มักมาจาก Admin/Boss)\n" +
               "- CANCEL_JOB (สำหรับยกเลิกงานที่เปิดไปแล้ว มักมาจาก Admin/Boss)\n" +
               "- LIST_PENDING_JOB (สำหรับขอดูงานค้าง มักมาจาก Technician)\n" +
               "- CLOSE_JOB (สำหรับส่งรูปปิดงาน มักมาจาก Technician)\n" +
               "- VIEW_REPORT (สำหรับขอดูรายงานสรุป มักมาจาก Boss)\n" +
               "- VIEW_SLA_REPORT (สำหรับขอดูรายงานสถิติเวลาการทำงาน หรือ SLA มักมาจาก Boss)\n" +
               "- CHECK_TECH_WORKLOAD (สำหรับดูภาระงานของช่างแต่ละคน มักมาจาก Admin/Boss)\n" +
               "- LIST_UNASSIGNED_JOB (สำหรับดูงานที่ยังไม่ได้แจก มักมาจาก Admin/Boss)\n" +
               "- LIST_ALL_PENDING_JOB (สำหรับดูงานค้างทั้งหมด มักมาจาก Admin/Boss)\n" +
               "- VIEW_JOB_DETAIL (สำหรับขอดูรายละเอียดงานใดงานหนึ่ง มักมาจาก Admin/Boss)\n" +
               "- UNKNOWN (หากไม่ตรงกับเจตนาใดเลย)\n\n" +
               "ข้อความ: " + text;

  var payload = {
    "contents": [{ "parts": [{ "text": prompt }] }],
    "generationConfig": { "temperature": 0.1 } // ใช้ temperature ต่ำเพื่อความแม่นยำและตอบตรงๆ
  };

  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var json = JSON.parse(response.getContentText());
    var answer = json.candidates[0].content.parts[0].text.trim().toUpperCase();
    
    // ตรวจสอบความถูกต้องของหมวดหมู่เผื่อ Gemini ตอบเกิน
    if (["CREATE_JOB", "ASSIGN_JOB", "CANCEL_JOB", "LIST_PENDING_JOB", "CLOSE_JOB", "VIEW_REPORT", "VIEW_SLA_REPORT", "CHECK_TECH_WORKLOAD", "LIST_UNASSIGNED_JOB", "LIST_ALL_PENDING_JOB", "VIEW_JOB_DETAIL"].indexOf(answer) !== -1) {
      return answer;
    }
    return "UNKNOWN";
  } catch (e) {
    console.error("Gemini Intent Error: " + e.message);
    return "UNKNOWN";
  }
}

// ---------------------------------------------------------
// Handlers for Specific Intents
// ---------------------------------------------------------

function handleViewReport(chatId, isBoss) {
  if (!isBoss) {
    sendTelegramMessage(chatId, "🛡️ ปฏิเสธการเข้าถึง: เฉพาะระดับผู้บริหารเท่านั้นที่สามารถดูรายงานได้");
    return;
  }

  sendTelegramMessage(chatId, "กำลังรวบรวมและวิเคราะห์ข้อมูลรายงาน กรุณารอสักครู่...");

  var ss = getSpreadsheet();
  var jobsSheet = ss.getSheetByName("Jobs");
  var data = jobsSheet.getDataRange().getValues();
  
  // แปลงข้อมูลเป็นข้อความเพื่อส่งให้ Gemini สรุป
  var dataString = "Job Data:\n";
  for (var i = 1; i < data.length; i++) { // Skip header
    dataString += "Job: " + data[i][0] + ", Status: " + data[i][9] + ", Detail: " + data[i][5] + "\n";
  }

  var prompt = "โปรดสรุปข้อมูลงานซ่อมบำรุงต่อไปนี้เป็นรายงานสั้นๆ สำหรับผู้บริหาร (สรุปจำนวนงานทั้งหมด, งานสำเร็จ, งานค้าง และไฮไลท์งานสำคัญ):\n\n" + dataString;
  var summary = callGemini(prompt);

  // สร้างไฟล์ PDF จากรายงาน
  try {
    var photosHtml = "";
    for (var j = 1; j < data.length; j++) {
      var photoUrlClose = data[j][10];
      var photoUrlReport = (data[j].length > 12) ? data[j][12] : "";
      
      var hasPhoto = (photoUrlClose && photoUrlClose !== "") || (photoUrlReport && photoUrlReport !== "");
      if (hasPhoto) {
        photosHtml += "<div style='margin-bottom: 20px;'>";
        photosHtml += "<h4 style='margin: 0; color: #333;'>รหัสงาน: " + data[j][0] + "</h4>";
        photosHtml += "<p style='margin: 5px 0;'><strong>อาการเสีย:</strong> " + data[j][5] + "</p>";
        
        // รูปก่อนซ่อม (Reported Photo)
        if (photoUrlReport && photoUrlReport !== "") {
          var matchReport = photoUrlReport.match(/\/d\/(.*?)\//);
          if (matchReport && matchReport[1]) {
            try {
              var imgFileReport = DriveApp.getFileById(matchReport[1]);
              var base64Report = Utilities.base64Encode(imgFileReport.getBlob().getBytes());
              var dataUriReport = "data:" + imgFileReport.getMimeType() + ";base64," + base64Report;
              photosHtml += "<div style='display:inline-block; margin-right:10px;'><strong>ก่อนซ่อม:</strong><br/><img src='" + dataUriReport + "' style='max-width: 300px; max-height: 300px; border: 1px solid #ccc; padding: 5px;' /></div>";
            } catch(err) {
              console.error("Failed to load reported image for " + data[j][0] + ": " + err.message);
            }
          }
        }
        
        // รูปหลังซ่อม (Closing Photo)
        if (photoUrlClose && photoUrlClose !== "") {
          var matchClose = photoUrlClose.match(/\/d\/(.*?)\//);
          if (matchClose && matchClose[1]) {
            try {
              var imgFileClose = DriveApp.getFileById(matchClose[1]);
              var base64Close = Utilities.base64Encode(imgFileClose.getBlob().getBytes());
              var dataUriClose = "data:" + imgFileClose.getMimeType() + ";base64," + base64Close;
              photosHtml += "<div style='display:inline-block;'><strong>หลังซ่อม:</strong><br/><img src='" + dataUriClose + "' style='max-width: 300px; max-height: 300px; border: 1px solid #ccc; padding: 5px;' /></div>";
            } catch(err) {
              console.error("Failed to load closing image for " + data[j][0] + ": " + err.message);
            }
          }
        }
        
        photosHtml += "</div><hr style='border: 0; border-top: 1px solid #eee;'/>";
      }
    }
    
    var appendixHtml = "";
    if (photosHtml !== "") {
      appendixHtml = "<div style='page-break-before: always;'></div>" +
                     "<div style='font-family: Arial, sans-serif; padding: 20px;'>" +
                     "<h2 style='color: #2c3e50;'>ภาคผนวก: ภาพประกอบงานซ่อม</h2>" + 
                     photosHtml + "</div>";
    }

    var htmlContent = "<div style='font-family: Arial, sans-serif; padding: 20px;'>" +
                      "<h2 style='color: #2c3e50;'>รายงานสรุปสถานะงานซ่อมบำรุง</h2>" +
                      "<p style='line-height: 1.6;'>" + summary.replace(/\n/g, "<br/>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") + "</p>" +
                      "</div>" + appendixHtml;
                      
    var blob = Utilities.newBlob(htmlContent, MimeType.HTML).setName("Report.html").getAs(MimeType.PDF);
    // ใช้ Folder ID แยกสำหรับ PDF โดยเฉพาะ (ตามที่กำหนดใน Config.js)
    var folderId = (typeof GOOGLE_DRIVE_PDF_FOLDER_ID !== 'undefined' && GOOGLE_DRIVE_PDF_FOLDER_ID !== "") 
                   ? GOOGLE_DRIVE_PDF_FOLDER_ID 
                   : GOOGLE_DRIVE_FOLDER_ID; // Fallback ไปโฟลเดอร์รูปภาพถ้าไม่ได้ตั้งค่า
    var folder = DriveApp.getFolderById(folderId);
    var pdfFile = folder.createFile(blob);
    pdfFile.setName("Maintenance_Report_" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd_HHmm") + ".pdf");
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var pdfUrl = pdfFile.getUrl();
    
    sendTelegramMessage(chatId, "📊 **รายงานสรุปสถานะงานซ่อมบำรุง**\n\n" + summary + "\n\n📄 **ดาวน์โหลดรายงาน (PDF):**\n" + pdfUrl);
  } catch (e) {
    console.error("PDF Gen Error: " + e.message);
    sendTelegramMessage(chatId, "📊 **รายงานสรุปสถานะงานซ่อมบำรุง**\n\n" + summary + "\n\n*(ระบบไม่สามารถสร้างไฟล์ PDF ได้: " + e.message + ")*");
  }
}

function handleCreateJob(chatId, text, isStateContinuation, photoArray) {
  var props = PropertiesService.getScriptProperties();
  var stateKey = "STATE_" + chatId;
  var draftKey = "DRAFT_" + chatId;
  var draftPhotoKey = "PHOTO_" + chatId;
  
  // จัดการรูปภาพแจ้งซ่อม
  var photoUrl = props.getProperty(draftPhotoKey) || "";
  if (photoArray && photoArray.length > 0) {
    var fileId = getTelegramFile(photoArray[photoArray.length - 1].file_id);
    if (fileId) {
      var tempId = "REP-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmm");
      photoUrl = saveToDrive(fileId, tempId);
      props.setProperty(draftPhotoKey, photoUrl);
    }
  }

  var prompt = "";
  if (isStateContinuation) {
    var previousDraftStr = props.getProperty(draftKey) || "{}";
    prompt = "จากข้อมูลเก่า: " + previousDraftStr + "\nและข้อความใหม่: " + text + "\nจงสกัดข้อมูลรวมกันออกมาเป็น JSON format ดังนี้ { \"Reporter_Name\": \"\", \"Reporter_Phone\": \"\", \"Location\": \"\", \"Issue_Detail\": \"\", \"Category\": \"\" } ถ้าไม่มีข้อมูลให้ใส่ค่าว่าง";
  } else {
    prompt = "จากข้อความแจ้งซ่อมต่อไปนี้ จงสกัดข้อมูลออกมาเป็น JSON format ดังนี้ { \"Reporter_Name\": \"\", \"Reporter_Phone\": \"\", \"Location\": \"\", \"Issue_Detail\": \"\", \"Category\": \"\" } ถ้าไม่มีข้อมูลให้ใส่ค่าว่าง\n\nข้อความ: " + text;
  }
  
  var aiResult = callGemini(prompt);
  
  try {
    // หา JSON ในคำตอบ
    var jsonMatch = aiResult.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("ไม่สามารถสกัดข้อมูลเป็น JSON ได้");
    var jobData = JSON.parse(jsonMatch[0]);

    // Validation (ตรวจสอบความครบถ้วน)
    if (!jobData.Location || !jobData.Issue_Detail || jobData.Location.trim() === "" || jobData.Issue_Detail.trim() === "") {
      // Save draft and set state
      props.setProperty(stateKey, "WAITING_JOB_DETAILS");
      props.setProperty(draftKey, JSON.stringify(jobData));
      
      var missing = [];
      if (!jobData.Location || jobData.Location.trim() === "") missing.push("สถานที่");
      if (!jobData.Issue_Detail || jobData.Issue_Detail.trim() === "") missing.push("อาการเสีย");
      
      sendTelegramMessage(chatId, "⚠️ ข้อมูลยังไม่ครบถ้วนครับ ขาดข้อมูล: **" + missing.join(" และ ") + "**\nกรุณาพิมพ์ข้อมูลที่ขาดเพิ่มเติมมาได้เลยครับ (ระบบกำลังจำข้อมูลเดิมรอไว้แล้ว)");
      return;
    }

    // Clear state since data is complete
    props.deleteProperty(stateKey);
    props.deleteProperty(draftKey);
    props.deleteProperty(draftPhotoKey);

    var jobId = "JOB-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMddHHmm");
    var timestamp = new Date();

    var ss = getSpreadsheet();
    var jobsSheet = ss.getSheetByName("Jobs");
    
    // ตรวจสอบคอลัมน์ M (13) สำหรับ Reported_Photo_URL
    var headers = jobsSheet.getRange(1, 1, 1, jobsSheet.getLastColumn()).getValues()[0];
    if (headers.length < 13 || headers[12] !== "Reported_Photo_URL") {
      jobsSheet.getRange(1, 13).setValue("Reported_Photo_URL");
    }

    // [Job_ID, Timestamp, Reporter_Name, Reporter_Phone, Location, Issue_Detail, Category, Technician_ID, Technician_Name, Status, Photo_URL, Closing_Note, Reported_Photo_URL]
    jobsSheet.appendRow([
      jobId, timestamp, jobData.Reporter_Name || "-", jobData.Reporter_Phone || "-",
      jobData.Location || "-", jobData.Issue_Detail || text, jobData.Category || "General",
      "", "", "Pending", "", "", photoUrl
    ]);

    sendTelegramMessage(chatId, "✅ บันทึกงานใหม่รหัส: " + jobId + " เรียบร้อยแล้ว");
    
    // แจ้งเตือนเข้ากลุ่มช่าง
    if (TELEGRAM_GROUP_CHAT_ID) {
      var alertMsg = "🚨 **มีงานซ่อมบำรุงใหม่เข้า!**\n" +
                     "รหัสงาน: " + jobId + "\n" +
                     "สถานที่: " + (jobData.Location || "-") + "\n" +
                     "รายละเอียด: " + (jobData.Issue_Detail || text);
      sendTelegramMessage(TELEGRAM_GROUP_CHAT_ID, alertMsg);
    }

  } catch (e) {
    sendTelegramMessage(chatId, "❌ เกิดข้อผิดพลาดในการสกัดข้อมูลงาน: " + e.message);
  }
}

function handleAssignJob(chatId, text, actorName) {
  // ให้ AI สกัดข้อมูลรหัสงานและชื่อช่าง
  var prompt = "จากข้อความการมอบหมายงานต่อไปนี้ จงสกัดข้อมูลออกมาเป็น JSON format ดังนี้ { \"Job_ID\": \"\", \"Target_Technician_Name\": \"\" } ถ้าไม่มีข้อมูลส่วนไหนให้ใส่ค่าว่าง (Job_ID เช่น JOB-123, Target_Technician_Name ให้เอาแค่ชื่อช่างสั้นๆ)\n\nข้อความ: " + text;
  var aiResult = callGemini(prompt);

  try {
    var jsonMatch = aiResult.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("ไม่สามารถสกัดข้อมูลเป็น JSON ได้");
    var assignData = JSON.parse(jsonMatch[0]);

    if (!assignData.Job_ID || !assignData.Target_Technician_Name) {
      sendTelegramMessage(chatId, "❌ ข้อมูลไม่ครบถ้วน กรุณาระบุรหัสงานและชื่อช่างให้ชัดเจน เช่น 'มอบหมายงาน JOB-123 ให้ช่างสมชาย'");
      return;
    }

    var targetJobId = assignData.Job_ID.toUpperCase();
    var targetTechName = assignData.Target_Technician_Name;

    var ss = getSpreadsheet();
    var techsSheet = ss.getSheetByName("Technicians");
    var jobsSheet = ss.getSheetByName("Jobs");
    
    // 1. ค้นหา Tech_ID และ Telegram Chat ID จากชื่อช่าง
    var techData = techsSheet.getDataRange().getValues();
    var foundTechs = [];

    for (var i = 1; i < techData.length; i++) {
      // ค้นหาแบบรวมๆ เผื่อพิมพ์ชื่อแค่บางส่วน
      if (techData[i][1].toString().indexOf(targetTechName) !== -1) {
        foundTechs.push({
          id: techData[i][0],
          name: techData[i][1],
          chatId: techData[i][3]
        });
      }
    }

    if (foundTechs.length === 0) {
      sendTelegramMessage(chatId, "❌ ไม่พบช่างชื่อ '" + targetTechName + "' ในระบบ");
      return;
    } else if (foundTechs.length > 1) {
      var duplicateMsg = "⚠️ พบช่างชื่อ '" + targetTechName + "' หลายคนในระบบ กรุณาระบุชื่อให้ชัดเจนอีกครั้ง เช่นพิมพ์รหัสช่าง หรือชื่อ-นามสกุลเต็ม:\n";
      for (var k = 0; k < foundTechs.length; k++) {
        duplicateMsg += "- " + foundTechs[k].name + " (" + foundTechs[k].id + ")\n";
      }
      sendTelegramMessage(chatId, duplicateMsg);
      return;
    }

    // กรณีเจอ 1 คนถ้วน
    var foundTechId = foundTechs[0].id;
    var actualTechName = foundTechs[0].name;
    var foundTechChatId = foundTechs[0].chatId;

    // 2. ค้นหา Job ID ใน Sheet
    var jobsData = jobsSheet.getDataRange().getValues();
    var jobRowIndex = -1;
    var jobDesc = "";
    var jobLocation = "";

    for (var j = 1; j < jobsData.length; j++) {
      if (jobsData[j][0] === targetJobId) {
        jobRowIndex = j + 1;
        jobLocation = jobsData[j][4];
        jobDesc = jobsData[j][5];
        break;
      }
    }

    if (jobRowIndex === -1) {
      sendTelegramMessage(chatId, "❌ ไม่พบงานรหัส " + targetJobId + " ในระบบ");
      return;
    }

    // 3. อัปเดตข้อมูลผู้รับผิดชอบงาน
    // Column H (8) = Technician_ID, Column I (9) = Technician_Name
    jobsSheet.getRange(jobRowIndex, 8).setValue(foundTechId);
    jobsSheet.getRange(jobRowIndex, 9).setValue(actualTechName);

    // บันทึก Log การแจกงานลง Closing_Note
    var timeStr = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm");
    var assignLog = "[มอบหมาย] โดย: " + actorName + " (" + timeStr + ")";
    var oldNote = jobsData[jobRowIndex-1][11];
    var newNote = oldNote ? oldNote + " | " + assignLog : assignLog;
    jobsSheet.getRange(jobRowIndex, 12).setValue(newNote);

    // 4. ส่งข้อความยืนยันให้ Admin
    sendTelegramMessage(chatId, "✅ โอนงาน " + targetJobId + " ให้ " + actualTechName + " เรียบร้อยแล้ว");

    // 5. แจ้งเตือนไปหาช่าง
    if (foundTechChatId) {
      var techMsg = "🚨 **คุณได้รับมอบหมายงานใหม่!**\n" +
                    "รหัสงาน: " + targetJobId + "\n" +
                    "สถานที่: " + jobLocation + "\n" +
                    "รายละเอียด: " + jobDesc + "\n" +
                    "(พิมพ์ 'ขอดูงานค้าง' เพื่อเช็ครายการงานของคุณ)";
      sendTelegramMessage(foundTechChatId.toString(), techMsg);
    }

  } catch (e) {
    sendTelegramMessage(chatId, "❌ เกิดข้อผิดพลาดในการโอนงาน: " + e.message);
  }
}

function handleListPendingJob(chatId, techId) {
  var ss = getSpreadsheet();
  var jobsSheet = ss.getSheetByName("Jobs");
  var data = jobsSheet.getDataRange().getValues();
  
  var pendingJobs = [];
  for (var i = 1; i < data.length; i++) {
    // Column 7 = Technician_ID, Column 9 = Status
    if (data[i][7] === techId && data[i][9] === "Pending") {
      pendingJobs.push("🔧 " + data[i][0] + ": " + data[i][5] + " (" + data[i][4] + ")");
    }
  }

  if (pendingJobs.length > 0) {
    var msg = "📋 **รายการงานค้างของคุณ:**\n\n" + pendingJobs.join("\n");
    sendTelegramMessage(chatId, msg);
  } else {
    sendTelegramMessage(chatId, "🎉 ยินดีด้วย! คุณไม่มีงานค้างในขณะนี้");
  }
}

function handleCloseJob(chatId, techId, techName, text, photoArray) {
  // 1. หา Job ID ในข้อความ
  var jobIdMatch = text.match(/JOB-\d+/i);
  if (!jobIdMatch) {
    sendTelegramMessage(chatId, "❌ ไม่พบรหัสงาน (เช่น JOB-1234) ในข้อความ กรุณาระบุรหัสงานที่ต้องการปิด");
    return;
  }
  var targetJobId = jobIdMatch[0].toUpperCase();

  // 2. ตรวจสอบใน Sheet ว่างานนี้เป็นของช่างคนนี้หรือไม่
  var ss = getSpreadsheet();
  var jobsSheet = ss.getSheetByName("Jobs");
  var data = jobsSheet.getDataRange().getValues();
  
  var jobRowIndex = -1;
  var jobOwnerId = "";
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === targetJobId) {
      jobRowIndex = i + 1; // +1 เพราะ data เริ่มจาก index 0 แต่ row ใน sheet เริ่มจาก 1
      jobOwnerId = data[i][7]; // Technician_ID
      break;
    }
  }

  if (jobRowIndex === -1) {
    sendTelegramMessage(chatId, "❌ ไม่พบงานรหัส " + targetJobId + " ในระบบ");
    return;
  }

  // 🛡️ กฎเหล็กป้องกันการปิดงานแทนกัน
  if (jobOwnerId !== techId) {
    sendTelegramMessage(chatId, "⛔ ปฏิเสธการปิดงาน: คุณไม่ได้รับมอบหมายให้จัดการงานนี้ ไม่สามารถปิดงานแทนกันได้");
    return;
  }

  // 3. จัดการรูปภาพเซฟลง Google Drive
  var photoUrl = "";
  if (photoArray && photoArray.length > 0) {
    var fileId = getTelegramFile(photoArray[photoArray.length - 1].file_id); // เอารูปความละเอียดสูงสุด
    if (fileId) photoUrl = saveToDrive(fileId, targetJobId);
  } else {
    sendTelegramMessage(chatId, "⚠️ คำเตือน: กรุณาแนบรูปภาพผลงานการซ่อมมาพร้อมกับการปิดงานด้วยครับ");
    return; // บังคับให้ส่งรูปภาพ
  }

  // 4. ให้ AI ปรับโน้ตเป็นภาษาราชการ
  var notePrompt = "ปรับแก้ข้อความต่อไปนี้ให้เป็นภาษาทางการ/ภาษาราชการ สำหรับบันทึกเป็นหลักฐานการซ่อมบำรุง:\n" + text;
  var formalNote = callGemini(notePrompt).trim();

  // 5. อัปเดต Sheet
  // Column J (10) = Status, Column K (11) = Photo_URL, Column L (12) = Closing_Note
  var timeStr = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm");
  var closeLog = "[ปิดงาน] โดย: " + techName + " (" + timeStr + ") รายละเอียด: " + formalNote;
  
  var oldNote = data[jobRowIndex-1][11];
  var newNote = oldNote ? oldNote + " | " + closeLog : closeLog;

  jobsSheet.getRange(jobRowIndex, 10).setValue("Success");
  jobsSheet.getRange(jobRowIndex, 11).setValue(photoUrl);
  jobsSheet.getRange(jobRowIndex, 12).setValue(newNote);

  sendTelegramMessage(chatId, "✅ ปิดงาน " + targetJobId + " เรียบร้อยแล้ว!\n🕒 เวลาปิดงาน: " + timeStr + "\n📝 บันทึก: " + formalNote);
}

function handleCheckWorkload(chatId) {
  var ss = getSpreadsheet();
  var jobsData = ss.getSheetByName("Jobs").getDataRange().getValues();
  var techsData = ss.getSheetByName("Technicians").getDataRange().getValues();
  
  var workloadMap = {}; // techId -> count
  for (var t = 1; t < techsData.length; t++) {
    workloadMap[techsData[t][0]] = { name: techsData[t][1], count: 0 };
  }
  
  for (var j = 1; j < jobsData.length; j++) {
    var status = jobsData[j][9];
    var tId = jobsData[j][7];
    if (status === "Pending" && tId && workloadMap[tId]) {
      workloadMap[tId].count++;
    }
  }
  
  var msg = "📊 **สรุปภาระงาน (Workload) ของช่างแต่ละคน:**\n\n";
  for (var key in workloadMap) {
    msg += "- " + workloadMap[key].name + " : " + workloadMap[key].count + " งาน\n";
  }
  sendTelegramMessage(chatId, msg);
}

function handleListUnassignedJob(chatId) {
  var ss = getSpreadsheet();
  var jobsData = ss.getSheetByName("Jobs").getDataRange().getValues();
  
  var unassigned = [];
  for (var j = 1; j < jobsData.length; j++) {
    var status = jobsData[j][9];
    var tId = jobsData[j][7];
    if (status === "Pending" && !tId) {
      unassigned.push("📌 " + jobsData[j][0] + " - " + jobsData[j][5] + " (" + jobsData[j][4] + ")");
    }
  }
  
  if (unassigned.length > 0) {
    sendTelegramMessage(chatId, "📋 **รายการงานที่ยังไม่ได้แจก (Unassigned):**\n\n" + unassigned.join("\n"));
  } else {
    sendTelegramMessage(chatId, "🎉 ไม่มีงานที่รอแจกครับ");
  }
}

function handleListAllPendingJob(chatId) {
  var ss = getSpreadsheet();
  var jobsData = ss.getSheetByName("Jobs").getDataRange().getValues();
  
  var pending = [];
  for (var j = 1; j < jobsData.length; j++) {
    var status = jobsData[j][9];
    if (status === "Pending") {
      var tName = jobsData[j][8] || "ยังไม่แจก";
      pending.push("⏳ " + jobsData[j][0] + " - " + jobsData[j][5] + " [ช่าง: " + tName + "]");
    }
  }
  
  if (pending.length > 0) {
    sendTelegramMessage(chatId, "📋 **รายการงานค้างทั้งหมด (All Pending):**\n\n" + pending.join("\n"));
  } else {
    sendTelegramMessage(chatId, "🎉 ไม่มีงานค้างในระบบครับ");
  }
}

function handleViewJobDetail(chatId, text) {
  // สกัดรหัสงาน
  var jobIdMatch = text.match(/JOB-\d+/i);
  if (!jobIdMatch) {
    sendTelegramMessage(chatId, "❌ ไม่พบรหัสงาน กรุณาระบุรหัสงาน เช่น 'ขอดูรายละเอียด JOB-123'");
    return;
  }
  var targetJobId = jobIdMatch[0].toUpperCase();
  
  var ss = getSpreadsheet();
  var jobsData = ss.getSheetByName("Jobs").getDataRange().getValues();
  var jobRow = null;

  for (var j = 1; j < jobsData.length; j++) {
    if (jobsData[j][0] === targetJobId) {
      jobRow = jobsData[j];
      break;
    }
  }
  
  if (!jobRow) {
    sendTelegramMessage(chatId, "❌ ไม่พบงานรหัส " + targetJobId);
    return;
  }
  
  var msg = "🔎 **รายละเอียดงาน " + targetJobId + "**\n";
  msg += "• วันที่แจ้ง: " + new Date(jobRow[1]).toLocaleDateString("th-TH") + "\n";
  msg += "• ผู้แจ้ง: " + jobRow[2] + " (" + jobRow[3] + ")\n";
  msg += "• สถานที่: " + jobRow[4] + "\n";
  msg += "• อาการเสีย: " + jobRow[5] + "\n";
  msg += "• หมวดหมู่: " + jobRow[6] + "\n";
  msg += "• ช่างรับผิดชอบ: " + (jobRow[8] || "-") + "\n";
  msg += "• สถานะ: " + jobRow[9] + "\n";
  if (jobRow[11]) msg += "• บันทึกปิดงาน: " + jobRow[11] + "\n";
  if (jobRow[10]) msg += "• ลิงก์รูปภาพ: " + jobRow[10] + "\n";
  
  sendTelegramMessage(chatId, msg);
}

function handleCancelJob(chatId, text, actorName) {
  var prompt = "จากข้อความการขอยกเลิกงานต่อไปนี้ จงสกัดข้อมูลออกมาเป็น JSON format ดังนี้ { \"Job_ID\": \"\", \"Cancel_Reason\": \"\" } ถ้าไม่มีข้อมูลส่วนไหนให้ใส่ค่าว่าง (Job_ID ต้องเป็นรูปแบบ JOB-XXX เสมอ)\n\nข้อความ: " + text;
  var aiResult = callGemini(prompt);

  try {
    var jsonMatch = aiResult.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("ไม่สามารถสกัดข้อมูลเป็น JSON ได้");
    var cancelData = JSON.parse(jsonMatch[0]);

    if (!cancelData.Job_ID) {
      sendTelegramMessage(chatId, "❌ กรุณาระบุรหัสงานที่ต้องการยกเลิกให้ชัดเจน เช่น 'ยกเลิกงาน JOB-123'");
      return;
    }

    var targetJobId = cancelData.Job_ID.toUpperCase();
    var reason = cancelData.Cancel_Reason || "ไม่มีระบุเหตุผล";
    var timeStr = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm");
    var cancelLogInfo = "ถูกยกเลิกโดย: " + actorName + " (" + timeStr + ") เหตุผล: " + reason;

    var ss = getSpreadsheet();
    var jobsSheet = ss.getSheetByName("Jobs");
    var jobsData = jobsSheet.getDataRange().getValues();
    
    var jobRowIndex = -1;
    for (var j = 1; j < jobsData.length; j++) {
      if (jobsData[j][0] === targetJobId) {
        jobRowIndex = j + 1;
        break;
      }
    }

    if (jobRowIndex === -1) {
      sendTelegramMessage(chatId, "❌ ไม่พบงานรหัส " + targetJobId + " ในระบบ");
      return;
    }

    // Column J (10) = Status, Column L (12) = Closing_Note
    jobsSheet.getRange(jobRowIndex, 10).setValue("Cancelled");
    var oldNote = jobsData[jobRowIndex-1][11]; // Index is row-1, column index 11 is Closing_Note
    var newNote = oldNote ? oldNote + " | [ยกเลิก] " + cancelLogInfo : "[ยกเลิก] " + cancelLogInfo;
    jobsSheet.getRange(jobRowIndex, 12).setValue(newNote);

    sendTelegramMessage(chatId, "✅ ยกเลิกงาน " + targetJobId + " เรียบร้อยแล้ว\n📝 ผู้ยกเลิก: " + actorName + "\n🕒 เวลา: " + timeStr + "\n💬 เหตุผล: " + reason);

  } catch (e) {
    sendTelegramMessage(chatId, "❌ เกิดข้อผิดพลาดในการยกเลิกงาน: " + e.message);
  }
}

function handleSlaReport(chatId, isBoss) {
  if (!isBoss) {
    sendTelegramMessage(chatId, "🛡️ ปฏิเสธการเข้าถึง: เฉพาะระดับผู้บริหารเท่านั้นที่สามารถดูรายงาน SLA ได้");
    return;
  }

  sendTelegramMessage(chatId, "กำลังประมวลผลสถิติ SLA และจัดอันดับ กรุณารอสักครู่...");

  var ss = getSpreadsheet();
  var jobsData = ss.getSheetByName("Jobs").getDataRange().getValues();
  var slaDataList = [];

  for (var i = 1; i < jobsData.length; i++) {
    var jobId = jobsData[i][0];
    var createTime = new Date(jobsData[i][1]);
    var techName = jobsData[i][8] || "N/A";
    var status = jobsData[i][9];
    var closingNote = jobsData[i][11] || "";
    
    var assignTimeMatch = closingNote.match(/\[มอบหมาย\].*?\((.*?)\)/);
    var assignTime = null;
    if (assignTimeMatch && assignTimeMatch[1]) {
      assignTime = parseThaiDateStr(assignTimeMatch[1]);
    }
    
    var closeTimeMatch = closingNote.match(/\[ปิดงาน\].*?\((.*?)\)/);
    var closeTime = null;
    if (closeTimeMatch && closeTimeMatch[1]) {
      closeTime = parseThaiDateStr(closeTimeMatch[1]);
    }
    
    if (status === "Success" && assignTime && closeTime) {
      var waitTimeToAssign = Math.round((assignTime - createTime) / 60000);
      var workTimeToClose = Math.round((closeTime - assignTime) / 60000);
      
      waitTimeToAssign = waitTimeToAssign < 0 ? 0 : waitTimeToAssign;
      workTimeToClose = workTimeToClose < 0 ? 0 : workTimeToClose;

      slaDataList.push({
        jobId: jobId,
        techName: techName,
        waitTimeToAssign: waitTimeToAssign,
        workTimeToClose: workTimeToClose
      });
    }
  }

  if (slaDataList.length === 0) {
    sendTelegramMessage(chatId, "📊 **รายงานสถิติ SLA**\nยังไม่มีข้อมูลงานที่ซ่อมเสร็จสมบูรณ์เพื่อใช้วิเคราะห์สถิติครับ");
    return;
  }

  var dataString = "SLA Data (Minutes):\n";
  for (var j = 0; j < slaDataList.length; j++) {
    var d = slaDataList[j];
    dataString += "Job: " + d.jobId + ", Tech: " + d.techName + ", WaitToAssign: " + d.waitTimeToAssign + " min, WorkToClose: " + d.workTimeToClose + " min\n";
  }

  var prompt = "โปรดสรุปข้อมูลสถิติ SLA ต่อไปนี้เป็นรายงานสำหรับผู้บริหาร โดยให้มีหัวข้อดังนี้ (ถ้าข้อมูลไหนไม่มีให้ข้ามไป):\n" +
               "1. ⏱️ ภาพรวม (ค่าเฉลี่ยเวลารอแจกงาน และ ค่าเฉลี่ยเวลาซ่อม)\n" +
               "2. ⚡ Top 3 งานที่ช่างซ่อมเสร็จไวที่สุด (ระบุชื่อช่างและเวลาที่ใช้)\n" +
               "3. 🐌 Top 3 งานที่ใช้เวลาซ่อมนานที่สุด (เพื่อนำไปวิเคราะห์ปัญหา)\n" +
               "แปลงหน่วยนาทีในข้อมูลดิบให้เป็น ชั่วโมง หรือ วัน ตามความเหมาะสมให้อ่านง่าย\n\nข้อมูลดิบ:\n" + dataString;

  var summary = callGemini(prompt);
  sendTelegramMessage(chatId, "📊 **รายงานสถิติ SLA & Performance**\n\n" + summary);
}

function parseThaiDateStr(dateStr) {
  var parts = dateStr.split(" ");
  if (parts.length !== 2) return null;
  var dParts = parts[0].split("/");
  var tParts = parts[1].split(":");
  if (dParts.length !== 3 || tParts.length !== 2) return null;
  return new Date(parseInt(dParts[2]), parseInt(dParts[1]) - 1, parseInt(dParts[0]), parseInt(tParts[0]), parseInt(tParts[1]));
}

// ---------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------

function sendTelegramMessage(chatId, text) {
  var url = "https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendMessage";
  var payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "Markdown"
  };
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };
  UrlFetchApp.fetch(url, options);
}

function callGemini(prompt) {
  var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GEMINI_API_KEY;
  var payload = {
    "contents": [{ "parts": [{ "text": prompt }] }]
  };
  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var json = JSON.parse(response.getContentText());
    return json.candidates[0].content.parts[0].text;
  } catch (e) {
    console.error("Gemini Generate Error: " + e.message);
    return prompt; // fallback to original text
  }
}

function getTelegramFile(fileId) {
  var url = "https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/getFile?file_id=" + fileId;
  var response = UrlFetchApp.fetch(url);
  var json = JSON.parse(response.getContentText());
  if (json.ok) {
    return json.result.file_path;
  }
  return null;
}

function saveToDrive(filePath, jobId) {
  var fileUrl = "https://api.telegram.org/file/bot" + TELEGRAM_TOKEN + "/" + filePath;
  var response = UrlFetchApp.fetch(fileUrl);
  var blob = response.getBlob();
  
  var folder = DriveApp.getFolderById(GOOGLE_DRIVE_FOLDER_ID);
  var file = folder.createFile(blob);
  file.setName(jobId + "_Evidence.jpg");
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  return file.getUrl();
}
