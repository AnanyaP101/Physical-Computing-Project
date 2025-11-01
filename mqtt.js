import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getDatabase, ref, set, push, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js";

// Firebase settings
const firebaseConfig = {
    apiKey: "AIzaSyBOqETnt1C8qhZ1YRYSotDxYjJeZEioTIM",
    authDomain: "petfeeder-promax-749f9.firebaseapp.com",
    databaseURL: "https://petfeeder-promax-749f9-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "petfeeder-promax-749f9",
    storageBucket: "petfeeder-promax-749f9.firebasestorage.app",
    messagingSenderId: "47994252501",
    appId: "1:47994252501:web:80c545a11a7abe0d4d065c"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const FEED_TIMEOUT = 10000;

// Mqtt settings
const host = "0b6280fa49a549c58dab95e2bb422274.s1.eu.hivemq.cloud";
const broker = `wss://${host}:8884/mqtt`;
const options = {
    username: "petfeederpromax",
    password: "Password12345",
    clientId: "web-" + Math.random().toString(16).substr(2, 8)
};

const PUBLISH_TOPIC = "petfeeder/cmd";
const SUBSCRIBE_TOPIC = "petfeeder/status";

const client = mqtt.connect(broker, options);

const feedBtn = document.getElementById("feedBtn");
const statusText = document.getElementById("status");

const openScheduleBtn  = document.getElementById("openScheduleBtn");
const schedule = document.getElementById("schedule");
const closeScheduleBtn = document.getElementById("closeScheduleBtn");

const timeInput = document.getElementById("timeInput");
const addTimeBtn = document.getElementById("addTimeBtn");
const scheduleList = document.getElementById("scheduleList");

const deleteModeBtn = document.getElementById("deleteModeBtn");
const saveScheduleBtn = document.getElementById("saveScheduleBtn");
const trashSymbol = "🗑";

let scheduleItems = [];
let deleteMode = false;

let feed_timer = null;


// ถ้ามีตัวจับเวลาตั้งไว้ก่อนหน้า ให้ clear ก่อน
function clearFeedTimer() {
    if (feed_timer) {
        clearTimeout(feed_timer);
        feed_timer = null;
    }
}

client.on("connect", () => {
    console.log("Connected to HiveMQ");
    statusText.textContent = "Connected ✅ ";
    client.subscribe(SUBSCRIBE_TOPIC);
    feedBtn.disabled = false;
});

client.on("error", (err) => {
    console.error("MQTT Error:", err);
    statusText.textContent = "Connection Error X";
    feedBtn.disabled = true;
    clearFeedTimer();
});

// ----------------message----------------------------------

client.on("message", (topic, message) => {
  if (topic !== SUBSCRIBE_TOPIC) return;

  const msg = message.toString().trim();
  console.log("Received:", msg);
  statusText.textContent = msg;
  feedBtn.disabled = false;
  clearFeedTimer();

  // สร้าง timestamp เวลาไทย
  const d = new Date();
  const localTime = d.toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })
                    .replace(",", "")
                    .replace(/\//g, "-")
                    .replace(" ", "_"); // กัน key ซ้ำใน Firebase

// Condition detected ------------------------------
  if (msg.toLowerCase().includes("detected")) {

    set(ref(db, `logs/sensor/${localTime}`), {
      event: msg
    });

    // แสดงผลในตาราง Pet Detection ------------------------------
    addRowToTable("DetectionTableBody", localTime, msg);

  } else if (msg.toLowerCase().includes("feed(manual)")) {

// Condition feeding done ------------------------------
    set(ref(db, `logs/feed/${localTime}`), {
      event: msg
    });

    // แสดงผลในตาราง Feed History ------------------------------
    addRowToTable("feedTableBody", localTime, msg);

  } else {
    // ---------- กรณีข้อความอื่น ----------
    console.warn("Unknown message:", msg);
  }
});




feedBtn.addEventListener("click", () => {
    feedBtn.disabled = true;
    
    clearFeedTimer();
    
    // ถ้าบอร์ดไม่ตอบกลับภายในเวลา จะปลดล็อกปุ่ม
    feed_timer = setTimeout(() => {
        console.warn("Feeding timeout");
        feedBtn.disabled = false;
        feed_timer = null;
        statusText.textContent = "No status from board";
    }, FEED_TIMEOUT);

    // ส่งคำสั่งไปบอร์ด
    client.publish(PUBLISH_TOPIC, "feed");
    statusText.textContent = "Feeding...";

    // ส่งไป Firebase
    var d = new Date();
    const localTime = d.toLocaleString("en-GB", { timeZone: "Asia/Bangkok" }).replace(",", "").replace(/\//g, "-");
    // console.log(localTime);
    set(ref(db, `logs/feed_click/${localTime}`), {
        event: "feed"
    });
});

function parseHHMM(time) {
    // แปลง HH:mm เป็นหน่วยนาที
    const x = (typeof time === "string") ? time : time.t; // รองรับ string และ object {t:"HH:mm"}
    const [hh, mm] = x.split(":").map(x => parseInt(x, 10));
    return (hh * 60) + mm;

}

// ฟังก์ชันเอาไว้ sort เวลา
function sortByTime(a, b) {
    return parseHHMM(a) - parseHHMM(b);
}


// <<----- เพิ่ม Table (Feed + Detection) ------>> 
import { onValue } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js";

const feedTableBody = document.getElementById("feedTableBody");
const DetectionTableBody = document.getElementById("DetectionTableBody");

/* ---------- ฟังก์ชันเพิ่มข้อมูลในตาราง ---------- */
function addRowToTable(tbody, timestamp, data) {
  const row = document.createElement("tr");
  const timeCell = document.createElement("td");
  const msgCell = document.createElement("td");

  timeCell.textContent = timestamp;
  msgCell.textContent = data.event || data.message || "-";

  row.appendChild(timeCell);
  row.appendChild(msgCell);

  // แทรกข้อมูลใหม่ไว้บนสุด
  tbody.insertBefore(row, tbody.firstChild);
}

/* ---------- ดึงข้อมูลจาก Firebase แบบเรียลไทม์ ---------- */

// ตาราง Feed History
const feedRef = ref(db, "logs/feed");
onValue(feedRef, (snapshot) => {
  const data = snapshot.val();
  feedTableBody.innerHTML = "";
  if (!data) return;

  // เรียงใหม่ → เก่า
  const entries = Object.entries(data).sort((a, b) => new Date(b[0]) - new Date(a[0]));
  entries.forEach(([timestamp, item]) => {
    addRowToTable(feedTableBody, timestamp, item);
  });
});

// ตาราง Pet Detection
const sensorRef = ref(db, "logs/sensor");
onValue(sensorRef, (snapshot) => {
  const data = snapshot.val();
  DetectionTableBody.innerHTML = "";
  if (!data) return;

  // เรียงใหม่ → เก่า
  const entries = Object.entries(data).sort((a, b) => new Date(b[0]) - new Date(a[0]));
  entries.forEach(([timestamp, item]) => {
    addRowToTable(DetectionTableBody, timestamp, item);
  });
});

//-----------------------------------------------------------

function renderSchedule() {
    scheduleItems.sort(sortByTime); // sort ก่อน render
    scheduleList.innerHTML = ""; // clear scheduleList เตรียม render ใหม่

    scheduleItems.forEach((item, index) => {
        const newSchedule = document.createElement("li");
        newSchedule.className = "schedule-item";

        const timeIndex = document.createElement("span");
        timeIndex.className = "time-badge";
        timeIndex.textContent = index + 1;
        
        const timeSpan = document.createElement("span");
        timeSpan.className = "time-badge";
        timeSpan.textContent = item.t;

        const trash = document.createElement("button");
        trash.className = "trash";
        trash.setAttribute("aria-label", "Delete");
        trash.textContent = trashSymbol;
        trash.addEventListener("click", () => {
            // ลบรายการนี้แล้ว render list ใหม่
            scheduleItems.splice(index, 1);
            renderSchedule();
        });

        newSchedule.appendChild(timeIndex);
        newSchedule.appendChild(timeSpan);
        newSchedule.appendChild(trash);
        scheduleList.appendChild(newSchedule);
    });
    
    scheduleList.classList.toggle("delete-mode", deleteMode);
}

openScheduleBtn.addEventListener("click", () => { 
    schedule.classList.add("show");
    schedule.setAttribute("aria-hidden", "false");
});

closeScheduleBtn.addEventListener("click", () => {
    schedule.classList.remove("show");
    schedule.setAttribute("aria-hidden", "true");
});

addTimeBtn.addEventListener("click", () => {
    const time = timeInput.value; // HH:mm

    // กันใส่ค่าว่างกับเวลาซ้ำ
    if ((!time || !/^\d{2}:\d{2}$/.test(time)) || (scheduleItems.some(it => it.t === time))) {
        timeInput.value = "";
        return;
    }
    
    scheduleItems.push({t: time});
    timeInput.value = "";
    renderSchedule();
});

deleteModeBtn.addEventListener("click", () => {
    deleteMode = !deleteMode;
    deleteModeBtn.textContent = (deleteMode) ? "Back" : "Delete";
    renderSchedule();
});

saveScheduleBtn.addEventListener("click", () => {
    // ส่งไป Firebase
    const updates = {
        schedule: scheduleItems,
    };
    update(ref(db), updates);
    // console.log(scheduleItems);
});

renderSchedule();