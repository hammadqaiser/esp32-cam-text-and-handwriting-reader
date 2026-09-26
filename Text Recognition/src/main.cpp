#include <WebServer.h>
#include <WiFi.h>
#include <esp_camera.h>
#include <esp32cam.h>
#include <SPI.h>
#include <Wire.h>
 
const char* WIFI_SSID = "esp32cam_color";
const char* WIFI_PASS = "12345678";
 
WebServer server(80);
 
void handleRoot()
{
  const char page[] = R"HTML(
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ESP32-CAM</title>
  <style>
    body { font-family: sans-serif; margin: 2rem auto; max-width: 900px; text-align: center; }
    img { display: block; width: 100%; height: auto; margin: 1rem 0; }
    button, a { display: inline-block; margin: .25rem; padding: .6rem 1rem; background: #1565c0; color: white; border: 0; text-decoration: none; cursor: pointer; }
    #result { white-space: pre-wrap; min-height: 2rem; padding: 1rem; background: #f1f1f1; text-align: left; }
  </style>
</head>
<body>
  <h1>ESP32-CAM</h1>
  <img id="camera" src="/cam-mid.jpg" alt="Camera image">
  <p>
    <button id="capture" type="button">Capture and read text</button>
    <a href="/cam-lo.jpg">Low resolution</a>
    <a href="/cam-mid.jpg">Medium resolution</a>
    <a href="/cam-hi.jpg">High resolution</a>
  </p>
  <h2>Recognized text</h2>
  <div id="result">Press Capture and read text.</div>
  <script>
    const camera = document.getElementById('camera');
    const result = document.getElementById('result');
    document.getElementById('capture').addEventListener('click', async function () {
      this.disabled = true;
      result.textContent = 'Capturing and reading...';
      try {
        const response = await fetch('/capture.jpg?t=' + Date.now());
        if (!response.ok) throw new Error('Camera capture failed');
        const image = await response.blob();
        camera.src = URL.createObjectURL(image);
        const ocrResponse = await fetch('http://127.0.0.1:5000/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: image
        });
        const data = await ocrResponse.json();
        if (!ocrResponse.ok) throw new Error(data.error || 'OCR request failed');
        result.textContent = (data.text || '(No text detected)') +
          (typeof data.confidence === 'number' ? '\nConfidence: ' + data.confidence + '%' : '');
      } catch (error) {
        result.textContent = error.message + '. Start webcam.py on this computer.';
      } finally {
        this.disabled = false;
      }
    });
    setInterval(function () {
      camera.src = '/cam-mid.jpg?t=' + Date.now();
    }, 1000);
  </script>
</body>
</html>
)HTML";
  server.send(200, "text/html", page);
}

 
static auto loRes = esp32cam::Resolution::find(320, 240);
static auto previewRes = esp32cam::Resolution::find(640, 480);
static auto ocrRes = esp32cam::Resolution::find(1600, 1200);
void serveJpg()
{
  auto frame = esp32cam::capture();
  if (frame == nullptr) {
    Serial.println("CAPTURE FAIL");
    server.send(503, "", "");
    return;
  }
  Serial.printf("CAPTURE OK %dx%d %db\n", frame->getWidth(), frame->getHeight(),
                static_cast<int>(frame->size()));
 
  server.setContentLength(frame->size());
  server.send(200, "image/jpeg");
  WiFiClient client = server.client();
  frame->writeTo(client);
}
 
void handleJpgLo()
{
  if (!esp32cam::Camera.changeResolution(loRes)) {
    Serial.println("SET-LO-RES FAIL");
  }
  serveJpg();
}
 
void handleJpgHi()
{
  if (!esp32cam::Camera.changeResolution(ocrRes)) {
    Serial.println("SET-HI-RES FAIL");
  }
  serveJpg();
}
 
void handleJpgMid()
{
  if (!esp32cam::Camera.changeResolution(previewRes)) {
    Serial.println("SET-MID-RES FAIL");
  }
  serveJpg();
}

void handleCapture()
{
  if (!esp32cam::Camera.changeResolution(ocrRes)) {
    Serial.println("SET-CAPTURE-RES FAIL");
  }
  serveJpg();
}
 
 
void  setup(){
  Serial.begin(115200);
  Serial.println();
  {
    using namespace esp32cam;
    Config cfg;
    cfg.setPins(pins::AiThinker);
    cfg.setResolution(ocrRes);
    cfg.setBufferCount(2);
    cfg.setJpeg(90);
 
    bool ok = Camera.begin(cfg);
    Serial.println(ok ? "CAMERA OK" : "CAMERA FAIL");
    if (ok) {
      sensor_t *s = esp_camera_sensor_get();
      if (s != nullptr) {
        s->set_hmirror(s, 1);
        s->set_vflip(s, 0);
        Serial.printf("CAMERA ORIENTATION hmirror=%u vflip=%u\n",
                      s->status.hmirror, s->status.vflip);
      } else {
        Serial.println("CAMERA SENSOR NOT FOUND");
      }
    }
  }
//   WiFi.persistent(false);
//   WiFi.mode(WIFI_STA);
//   WiFi.begin(WIFI_SSID, WIFI_PASS);
  WiFi.softAP(WIFI_SSID, WIFI_PASS);
  Serial.println("Access Point created.");
//   while (WiFi.status() != WL_CONNECTED) {
//     delay(500);
//   }
  Serial.println("");
  Serial.println("APIP address: ");
  Serial.print("http://");
  Serial.println(WiFi.softAPIP());
//   Serial.println(WiFi.localIP());
  Serial.println("  /cam-lo.jpg");
  Serial.println("  /cam-hi.jpg");
  Serial.println("  /cam-mid.jpg");
 
  server.on("/", handleRoot);
  server.on("/cam-lo.jpg", handleJpgLo);
  server.on("/cam-hi.jpg", handleJpgHi);
  server.on("/cam-mid.jpg", handleJpgMid);
  server.on("/capture.jpg", handleCapture);
 
  server.begin();
}
 
void loop()
{
  server.handleClient();
}