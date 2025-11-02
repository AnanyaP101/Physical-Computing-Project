import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getDatabase, ref, set, push, update, get } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js";

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

const FEED_TIMEOUT = 20000;

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

const amountText = document.getElementById("amount");
const detectText = document.getElementById("detected");
const petStatusText = document.getElementById("petStatus");
const countText = document.getElementById("countPerDay");
const resetRemainBtn = document.getElementById("resetRemainBtn");

let scheduleItems = [];
let deleteMode = false;

let feed_timer = null;

const maxAmount = 1000;
const amountPerFeed = 100; // ให้ทีละเท่าไหร่
let amountLeft = maxAmount;

const feedRef = ref(db, "logs/feed");
const sensorRef = ref(db, "logs/sensor");

// ถ้ามีตัวจับเวลาตั้งไว้ก่อนหน้า ให้ clear ก่อน
function clearFeedTimer() {
    if (feed_timer) {
        clearTimeout(feed_timer);
        feed_timer = null;
    }
}

client.on("connect", () => {
    console.log("Connected to HiveMQ");
    statusText.textContent = "Connected";
    client.subscribe(SUBSCRIBE_TOPIC);
    feedBtn.disabled = false;
});

client.on("error", (err) => {
    console.error("MQTT Error:", err);
    statusText.textContent = "Connection Error";
    feedBtn.disabled = true;
    clearFeedTimer();
});

// ----------------message----------------------------------

client.on("message", (topic, message) => {
    if (topic != SUBSCRIBE_TOPIC) return;

    const msg = message.toString();
    console.log(msg);
    if (msg == "feed_auto" || msg == "feed_manual") {
        statusText.textContent = "Feeding Done";
        if(amountLeft >= amountPerFeed) {
            amountLeft -= amountPerFeed;
            amountText.textContent = amountLeft + " g";
        }
    }
    
    feedBtn.disabled = false;
    clearFeedTimer();

    // สร้าง timestamp เวลาไทย
    var d = new Date();
    const localTime = d.toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })
                    .replace(",", "")
                    .replace(/\//g, "-") // กัน key ซ้ำใน Firebase

    let address = `logs/feed/${localTime}`;
    let text = "Feed";
    if(msg == "feed_auto") {
        text = "Feed (auto)";
    } else if(msg == "feed_manual") {
        text = "Feed (manual)"
    } else if(msg == "Cat !!") {
        address = `logs/sensor/${localTime}`;
        text = "Cat Detected!";
        petStatusText.textContent = "Your pet is here!";
        detectText.textContent = "In front of you!";


        setTimeout(async () => {
            try {
                const snap = await get(sensorRef);
                const data = snap.val();
                if (!data) return;

                const entries = Object.entries(data).sort((a, b) => new Date(b[0]) - new Date(a[0]));
                const [lastKey] = entries[0]; // เอา timestamp ล่าสุด
                const lastFeedTime = lastKey.split(" ")[1];

                // ตรวจว่าผ่านไป 2 นาทีแล้วยังไม่มี sensor ใหม่หรือไม่
                const lastTime = new Date(lastKey).getTime();
                const now = Date.now();
                const diffMs = now - lastTime;
                const diffMin = diffMs / 60000; // แปลงเป็นนาที

                if (diffMin >= 2) {
                    petStatusText.textContent = "No one here!";
                    detectText.textContent = lastFeedTime;
                }
            } catch (err) {
                console.error("Error checking last detection:", err);
            }
        }, 120000); // รอ 2 นาที
    }

    // ส่งไป Firebase
    set(ref(db, address), {
        event: text
    });
});


feedBtn.addEventListener("click", () => {
    if(amountLeft < amountPerFeed) {
        statusText.textContent = "Not Enough Food!";
        return;
    }
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
});

function parseHHMM(time) {
    // แปลง HH:mm เป็นหน่วยนาที
    const [hh, mm] = time.split(":").map(n => parseInt(n, 10));
    return (hh * 60) + mm;

}

// ฟังก์ชันเอาไว้ sort เวลา
function sortByTime(a, b) {
    return parseHHMM(a) - parseHHMM(b);
}


// เพิ่ม Table (Feed + Detection)
import { onValue } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js";

const feedTableBody = document.getElementById("feedTableBody");
const DetectionTableBody = document.getElementById("DetectionTableBody");

// ฟังก์ชันเพิ่มข้อมูลในตาราง
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
onValue(feedRef, (snapshot) => {
  const data = snapshot.val();
  feedTableBody.innerHTML = "";
  if (!data) return;

  const today = new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })
                    .replace(",", "")
                    .replace(/\//g, "-").split(" ")[0];
  let count = 0;
  Object.keys(data).forEach(date => { // นับครั้งที่ให้อาหาร ในวันเดียวกัน
    if (date.split(" ")[0] === today) count++;
  });

  countText.textContent = count;

  amountText.textContent = amountLeft + " g";
  // เรียงใหม่ → เก่า
  const entries = Object.entries(data).sort((a, b) => new Date(a[0]) - new Date(b[0]));
  entries.forEach(([timestamp, item]) => {
    addRowToTable(feedTableBody, timestamp, item);
  });
});

// ตาราง Pet Detection
onValue(sensorRef, (snapshot) => {
  const data = snapshot.val();
  DetectionTableBody.innerHTML = "";
  if (!data) return;

  // เรียงใหม่ → เก่า
  const entries = Object.entries(data).sort((a, b) => new Date(a[0]) - new Date(b[0]));
  entries.forEach(([timestamp, item]) => {
    addRowToTable(DetectionTableBody, timestamp, item);
  });
});

//-----------------------------------------------------------
function renderSchedule() {
    scheduleItems.sort(sortByTime); // sort ก่อน render
    scheduleList.innerHTML = ""; // clear scheduleList เตรียม render ใหม่

    scheduleItems.forEach((time, index) => {
        const newSchedule = document.createElement("li");
        newSchedule.className = "schedule-item";

        const timeIndex = document.createElement("span");
        timeIndex.className = "time-badge";
        timeIndex.textContent = index + 1;
        
        const timeSpan = document.createElement("span");
        timeSpan.className = "time-badge";
        timeSpan.textContent = time;

        const trash = document.createElement("button");
        trash.className = "trash";
        trash.setAttribute("aria-label", "Delete");
        trash.textContent = trashSymbol;
        trash.addEventListener("click", () => {
            // ลบรายการนี้แล้ว render list ใหม่
            scheduleItems.splice(index, 1);
            updateSchedule();
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
    if ((!time || !/^\d{2}:\d{2}$/.test(time)) || (scheduleItems.some(it => it === time))) {
        timeInput.value = "";
        return;
    }
    
    scheduleItems.push(time);
    timeInput.value = "";
    renderSchedule();
});

deleteModeBtn.addEventListener("click", () => {
  deleteMode = !deleteMode;
  deleteModeBtn.textContent = (deleteMode) ? "Back" : "Delete";
  renderSchedule();
});

saveScheduleBtn.addEventListener("click", () => {
  updateSchedule();
});

function updateSchedule() {
  // ส่งไป Firebase
  const updates = {
      schedule: scheduleItems,
  };
  update(ref(db), updates);
  // console.log(scheduleItems);

  client.publish(PUBLISH_TOPIC, "updateSchedule")
}

resetRemainBtn.addEventListener("click", () => {
    amountLeft = maxAmount;
    amountText.textContent = amountLeft + " g";
});

const quotes = [
  "โดนแดดเธอจะร้อน ถ้าโดนแมวอ้อนละเธอจะรัก",
  "อาหารแมวต้องวิสกัส อาหารรักต้อง with me",
  "อยู่ใกล้แมวระวังแพ้ขน อยู่ใกล้ผมระวังแพ้ใจ",
  "ลืมอะไรก็ลืมได้ แต่จะลืมให้อาหารแมวไม่ได้",
  "มีแมวต้องมีโอ แต่ถ้าอยากหัวใจพองโตต้องมีเรา",
  "สวัสดีวันจันทร์ 🌻",
  "ขอให้วันนี้มีเรื่องดีๆเกิดขึ้นนะ",
  "สัตว์เลี้ยงแสนน่ารักคุณอยู่ !",
  "ซื้อของเล่นให้เป็นแสน แม้แต่แขนยังไม่ได้จับ"
];

function showRandomQuote() {
  const randomIndex = Math.floor(Math.random() * quotes.length);
  quoteBar.textContent = quotes[randomIndex];
}

window.addEventListener("load", showRandomQuote);
renderSchedule();