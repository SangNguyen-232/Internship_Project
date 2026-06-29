#include "task_webserver.h"
#include <WiFi.h>
#include "pump.h"

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

bool webserver_isrunning = false;

String global_pump_state = "OFF"; 
String global_pump_mode = "AUTO"; 

void Webserver_sendata(String data)
{
    if (ws.count() > 0)
    {
        ws.textAll(data); // Gửi đến tất cả client đang kết nối
        Serial.println("📤 Đã gửi dữ liệu qua WebSocket: " + data);
    }
    else
    {
        Serial.println("⚠️ Không có client WebSocket nào đang kết nối!");
    }
}

void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len)
{
    if (type == WS_EVT_CONNECT)
    {
        Serial.printf("WebSocket client #%u connected from %s\n", client->id(), client->remoteIP().toString().c_str());
    }
    else if (type == WS_EVT_DISCONNECT)
    {
        Serial.printf("WebSocket client #%u disconnected\n", client->id());
    }
    else if (type == WS_EVT_DATA)
    {
        AwsFrameInfo *info = (AwsFrameInfo *)arg;

        if (info->opcode == WS_TEXT)
        {
            String message;
            message += String((char *)data).substring(0, len);
            // parseJson(message, true);
            // handleWebSocketMessage(message); 
        }
    }
}

void connnectWSV()
{
    ws.onEvent(onEvent);
    server.addHandler(&ws);

    // Phục vụ mọi file tĩnh trong LittleFS, mặc định trả về dashboard.html khi vào "/"
    server.serveStatic("/", LittleFS, "/").setDefaultFile("dashboard.html");

    // ---------- Định tuyến các API HTTP cho ESP32 ----------
    
    // 1. API lấy trạng thái hệ thống (MQTT / Hardware / AP Mode)
    server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest *request) {
        bool is_ap_mode = (WiFi.getMode() == WIFI_AP) || (WiFi.getMode() == WIFI_AP_STA && WiFi.status() != WL_CONNECTED);

        String json = "{\"mqtt_connected\": true, \"is_ap_mode\": " + String(is_ap_mode ? "true" : "false") + "}"; 
        request->send(200, "application/json", json);
    });

    // 2. API chuyển đổi trạng thái Bơm (Khi kích hoạt, ép MODE sang MANUAL)
    server.on("/toggle-pump", HTTP_GET, [](AsyncWebServerRequest *request) {
        if (request->hasParam("state")) {
            global_pump_state = request->getParam("state")->value();
            global_pump_state.toUpperCase();
        } else {
            global_pump_state = (global_pump_state == "ON") ? "OFF" : "ON";
        }
        
        global_pump_mode = "MANUAL";
        Serial.println("⚙️ Người dùng can thiệp nút PUMP -> Ép hệ thống sang chế độ MANUAL.");

        // ---- KHU VỰC ĐIỀU KHIỂN PHẦN CỨNG THẬT ----
        if (xSemaphoreTake(xMutexPumpControl, portMAX_DELAY) == pdTRUE) {
            pump_manual_control = true;
            pump_manual_state = (global_pump_state == "ON");
            xSemaphoreGive(xMutexPumpControl);
        }
        // --------------------------------------------

        Webserver_sendata("{\"pump_state\":\"" + global_pump_state + "\",\"pump_mode\":\"" + global_pump_mode + "\"}");
        
        request->send(200, "text/plain", global_pump_state);
    });

    // 3. API thay đổi Chế độ (AUTO / MANUAL)
    server.on("/set-mode", HTTP_GET, [](AsyncWebServerRequest *request) {
        if (request->hasParam("mode")) {
            global_pump_mode = request->getParam("mode")->value();
            global_pump_mode.toUpperCase();
        } else {
            global_pump_mode = (global_pump_mode == "MANUAL") ? "AUTO" : "MANUAL";
        }
        
        Serial.printf("⚙️ Chế độ hệ thống thay đổi thành: %s\n", global_pump_mode.c_str());

        if (xSemaphoreTake(xMutexPumpControl, portMAX_DELAY) == pdTRUE) {
            pump_manual_control = (global_pump_mode == "MANUAL");
            if (pump_manual_control) {
                pump_manual_state = (global_pump_state == "ON");
            }
            xSemaphoreGive(xMutexPumpControl);
        }

        Webserver_sendata("{\"pump_state\":\"" + global_pump_state + "\",\"pump_mode\":\"" + global_pump_mode + "\"}");
        
        request->send(200, "text/plain", global_pump_mode);
    });
    server.begin();
    ElegantOTA.begin(&server);
    webserver_isrunning = true;
}

void Webserver_stop()
{
    ws.closeAll();
    server.end();
    webserver_isrunning = false;
}

void Webserver_reconnect()
{
    if (!webserver_isrunning)
    {
        connnectWSV();
    }
    ElegantOTA.loop();
}