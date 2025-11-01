#include <WiFiS3.h>
#include <Servo.h>
#include <WiFiSSLClient.h>
#include <MQTTClient.h>

// -------- Wi-Fi
const char WIFI_SSID[] = "--";       //ใส่ชื่อ wifi
const char WIFI_PASSWORD[] = "--";  // รหัส wifi

// ------- HiveMQ Cloud 

const char MQTT_BROKER_ADDRESS[] = "0b6280fa49a549c58dab95e2bb422274.s1.eu.hivemq.cloud";
const char MQTT_CLIENT_ID[] = "petfeeder-r4-01";
const int  MQTT_PORT = 8883; // TLS Port
const char MQTT_USERNAME[] = "petfeederpromax";  
const char MQTT_PASSWORD[] = "Password12345";  

// -------- MQTT Topics 
const char SUBSCRIBE_TOPIC[] = "petfeeder/cmd";      // รับคำสั่งจาก website
const char PUBLISH_TOPIC[]   = "petfeeder/status";   // ส่ง status กลับ

// ---------arduino-board set up

  const int trigPin = 3;
  const int echoPin = 4;
  long duration;
  int distanceCm, distanceInch;

Servo feederServo;
const int SERVO_PIN = 9;
const int LED_PIN = 11;
const long FEED_DURATION = 1500;  // หน่วงเปิด 1.5 วินาที

WiFiSSLClient net; //TSL SSL
MQTTClient mqtt(256);

String actionState = "idle";

//-------- function
void connectWiFi();
void connectMQTT();
void messageReceived(String &topic, String &payload);
void feedCat();


// ------- Setup

void setup() {

  Serial.begin(115200); 
  pinMode(LED_PIN, OUTPUT);

  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);

  feederServo.attach(SERVO_PIN);
  feederServo.write(0); // ปิดเริ่มต้น

  connectWiFi();
  connectMQTT();
  
}

// Loop
unsigned long lastSensorUpdate = 0;

void loop() {

  mqtt.loop();

  if (millis() - lastSensorUpdate > 3000) {
    measureDistance();
    lastSensorUpdate = millis();
  }
}

//  Connect Wi-Fi 

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



// รับ msg จาก mqtt 
void messageReceived(String &topic, String &payload) {
  
  Serial.print("IN: ");
  Serial.print(topic);
  Serial.print(" -> ");

//ถ้ารับ msg 'feed'
  if (String(topic) == SUBSCRIBE_TOPIC && payload == "feed") {
    feedCat(); 
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

// feed funtion 
void feedCat() {

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

    mqtt.publish(PUBLISH_TOPIC, "Feeding done"); //ให้ อาหารสำเร็จ
}
// ---------------------------------------------------------
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
    mqtt.publish(PUBLISH_TOPIC, "detected"); //พบแมวในระยะ msg : detected
    Serial.println("Cat here!");
  }
}




  