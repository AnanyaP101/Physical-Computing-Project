#include <WiFiS3.h>
#include <Servo.h>
#include <WiFiSSLClient.h>
#include <MQTTClient.h>
#include <WiFiUdp.h> // NTP
#include <ArduinoJson.h>

// Wi-Fi
const char WIFI_SSID[] = "--"; //ใส่ชื่อ wifi
const char WIFI_PASSWORD[] = "--"; // รหัส wifi

// HiveMQ Cloud 
const char MQTT_BROKER_ADDRESS[] = "0b6280fa49a549c58dab95e2bb422274.s1.eu.hivemq.cloud";
const char MQTT_CLIENT_ID[] = "petfeeder-r4-01";
const int  MQTT_PORT = 8883; // TLS Port
const char MQTT_USERNAME[] = "petfeederpromax";  
const char MQTT_PASSWORD[] = "Password12345";  

// MQTT Topics 
const char SUBSCRIBE_TOPIC[] = "petfeeder/cmd"; // รับคำสั่งจาก website
const char PUBLISH_TOPIC[] = "petfeeder/status"; // ส่ง status กลับ

// Firebase
const char FIREBASE_HOST[] = "petfeeder-promax-749f9-default-rtdb.asia-southeast1.firebasedatabase.app";
const int FIREBASE_PORT = 443;

// NTP
WiFiUDP ntpUDP;
const char ntpServer[] = "pool.ntp.org";
const unsigned int NTP_PACKET_SIZE = 48;
byte packetBuffer[NTP_PACKET_SIZE];
unsigned long lastNtpSync = 0;
unsigned long currentEpoch = 0;

// Schedule
DynamicJsonDocument scheduleList(2048); // ใช้ json

// Ultrasonic Sensor
const int trigPin = 3;
const int echoPin = 4;
long duration;
int distanceCm;
unsigned long lastSensorUpdate = 0;

// Servo
Servo feederServo;
const int SERVO_PIN = 9;
const int LED_PIN = 11;
const long FEED_DURATION = 1500;  // หน่วงเปิด 1.5 วิ

WiFiSSLClient net; // TSL SSL (ของ mqtt)
MQTTClient mqtt(256);
WiFiSSLClient https; // (ของ firebase)

String actionState = "idle";

String lastFedAt = "";

void setup() {
  Serial.begin(115200); 
  pinMode(LED_PIN, OUTPUT);

  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);

  feederServo.attach(SERVO_PIN);
  feederServo.write(0); // ตอนเริ่มให้ปิด

  connectWiFi();

  syncTimeFromNTP();
  connectMQTT();
}


void loop() {
  mqtt.loop();
  
  if (millis() - lastSensorUpdate > 3000) { // เช็ค sensor ทุกๆ 3 วิ
    measureDistance();
    lastSensorUpdate = millis();
  }

  String now = getCurrentTime();
  if (lastFedAt != now) { // เช็คกันให้ซ้ำ
    JsonArray arr = scheduleList.as<JsonArray>();
    for (int i = 0; i < arr.size(); i++) {
      String time = arr[i];
      if (now == time) {
        Serial.print("Feeding triggered at: ");
        Serial.println(now);

        feedCat("auto");
        lastFedAt = now; // บันทึกเวลาให้อาหารล่าสุด
        break;
      }
    }
  }
  delay(2000);
}


void connectWiFi() {
  Serial.print("Connecting to WiFi...");

  while (WiFi.begin(WIFI_SSID, WIFI_PASSWORD) != WL_CONNECTED) {
    Serial.print(".");
    delay(2000);
  }

  Serial.println("\nWiFi connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
}


void connectMQTT() {
  mqtt.begin(MQTT_BROKER_ADDRESS, MQTT_PORT, net);
  mqtt.onMessage(messageReceived);

  Serial.print("Connecting to HiveMQ Cloud : ");
  Serial.println(MQTT_BROKER_ADDRESS);

  while(!mqtt.connect(MQTT_CLIENT_ID, MQTT_USERNAME, MQTT_PASSWORD)) {
    Serial.print(".");
    delay(2000);
  }
  Serial.println("\nConnected to HiveMQ Cloud!");
  mqtt.subscribe(SUBSCRIBE_TOPIC);
  Serial.print("Subscribed: ");
  Serial.println(SUBSCRIBE_TOPIC);
}


void messageReceived(String &topic, String &payload) {
  if (String(topic) == SUBSCRIBE_TOPIC && payload == "feed") { // ถ้ารับ msg สั่ง feed
    feedCat("manual"); 
  } else if (String(topic) == SUBSCRIBE_TOPIC && payload == "updateSchedule") { // ถ้ารับ msg สั่ง updateSchedule
    fetchSchedule();
  }
}


// หมุนค่อยๆ
void smoothMove(int startAngle, int endAngle, int stepDelay) {
  if (startAngle < endAngle) {
    for (int pos = startAngle; pos <= endAngle; pos++) {
      feederServo.write(pos);
      delay(stepDelay);
    }
  } else {
    for (int pos = startAngle; pos >= endAngle; pos--) {
      feederServo.write(pos);
      delay(stepDelay);
    }
  }
}


void feedCat(String type) {
  Serial.println("Feeding command received!");
  actionState = "feeding";
  digitalWrite(LED_PIN, HIGH);

  Serial.println("Feeding started");

  smoothMove(0, 70, 15);
  delay(FEED_DURATION);
  smoothMove(70, 0, 15);

  actionState = "idle";
  Serial.println("Feeding done");
  digitalWrite(LED_PIN, LOW);
  
  if (type == "auto") {
    mqtt.publish(PUBLISH_TOPIC, "feed_auto");
  } else if (type == "manual") {
    mqtt.publish(PUBLISH_TOPIC, "feed_manual");
  }
}


void measureDistance() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);

  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  duration = pulseIn(echoPin, HIGH);
  distanceCm = duration * 0.034 / 2;

  Serial.print("Distance: ");
  Serial.print(distanceCm);
  Serial.println(" cm");

  sensor();
}


void sensor(){
  if (distanceCm <= 50 ) {
    mqtt.publish(PUBLISH_TOPIC, "Cat !!");
    Serial.println("Cat here!");
  }
}


// NTP + เวลา
void sendNTPpacket(const char* address) {
  memset(packetBuffer, 0, NTP_PACKET_SIZE);
  packetBuffer[0] = 0b11100011;   // LI, Version, Mode
  packetBuffer[1] = 0;     // Stratum, or type of clock
  packetBuffer[2] = 6;     // Polling Interval
  packetBuffer[3] = 0xEC;  // Peer Clock Precision

  ntpUDP.begin(2390);
  ntpUDP.beginPacket(address, 123); // NTP request is to port 123
  ntpUDP.write(packetBuffer, NTP_PACKET_SIZE);
  ntpUDP.endPacket();
}


void syncTimeFromNTP() {
  Serial.println("Syncing time from NTP...");
  sendNTPpacket(ntpServer);
  delay(1000);

  int cb = ntpUDP.parsePacket();
  if (!cb) {
    Serial.println("No NTP packet yet");
    return;
  }
  ntpUDP.read(packetBuffer, NTP_PACKET_SIZE);

  // NTP time starts on 1900, Unix on 1970, difference is 70 years:
  unsigned long highWord = word(packetBuffer[40], packetBuffer[41]);
  unsigned long lowWord  = word(packetBuffer[42], packetBuffer[43]);
  unsigned long secsSince1900 = (highWord << 16) | lowWord;
  const unsigned long seventyYears = 2208988800UL;
  currentEpoch = secsSince1900 - seventyYears; // now in UTC
  lastNtpSync = millis();
  Serial.print("Epoch(UTC): ");
  Serial.println(currentEpoch);
}


String getCurrentTime() {
  if (currentEpoch == 0) return "00:00";
  unsigned long lastSync = (millis() - lastNtpSync) / 1000;
  unsigned long now = currentEpoch + lastSync;

  // timezone +7
  now += 7 * 3600;
  unsigned long secs = now % 86400;
  int hh = secs / 3600;
  int mm = (secs % 3600) / 60;

  char currentTime[6];
  sprintf(currentTime, "%02d:%02d", hh, mm);
  return String(currentTime);
}


void fetchSchedule() {
  Serial.println("Fetching schedule");

  if (!https.connect(FIREBASE_HOST, FIREBASE_PORT)) {
    Serial.println("HTTPS connect failed");
    return;
  }
  
  https.println("GET /schedule.json HTTP/1.1");
  https.print("Host: ");
  https.println(FIREBASE_HOST);
  https.println("User-Agent: ArduinoWiFi/1.1");
  https.println("Connection: close");
  https.println();

  bool headersEnded = false;
  String payload = "";


  while (https.connected() || https.available()) {
    if (https.available()) {
      String line = https.readStringUntil('\n');
      if (!headersEnded) {
        if (line == "\r") { // บรรทัดว่าง = จบส่วน header
          headersEnded = true;
        }
      } else {
        payload += line;
      }
    }
  }

  https.stop();

  Serial.println("======payload======");
  Serial.println(payload);

  scheduleList.clear();

  DeserializationError err = deserializeJson(scheduleList, payload);
  if (err) {
    Serial.print("deserializeJson failed: ");
    Serial.println(err.f_str());
    return;
  }
  JsonArray arr = scheduleList.as<JsonArray>();
  if (arr.isNull()) {
    Serial.println("schedule is null or not array");
    return;
  }

  for (int i = 0; i < arr.size(); i++) {
    const char* time = arr[i];
    if (time) {
      Serial.println(time);
    }
  }
}
