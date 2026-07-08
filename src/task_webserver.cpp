#include "task_webserver.h"
#include <WiFi.h>
#include "pump.h"
#include "global.h"

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

bool webserver_isrunning = false;

String global_pump_state = "OFF"; 
String global_pump_mode = "AUTO"; 
String global_admin_ip = "";

static SharedContext* s_ctx = nullptr;

void Webserver_init_ctx(SharedContext* ctx)
{
    s_ctx = ctx;
}

void Webserver_sendata(String data)
{
    if (ws.count() > 0)
    {
        ws.textAll(data);
    }
}

static void captureAdminIp(AsyncWebServerRequest *request)
{
    String ip = request->client()->remoteIP().toString();
    if (!ip.isEmpty() && ip != "0.0.0.0")
    {
        global_admin_ip = ip;
    }
}

void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len)
{
    if (type == WS_EVT_CONNECT)
    {
        String ip = client->remoteIP().toString();
        if (!ip.isEmpty() && ip != "0.0.0.0")
        {
            global_admin_ip = ip;
        }
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
            handleWebSocketMessage(message);
        }
    }
}

void connnectWSV()
{
    ws.onEvent(onEvent);
    server.addHandler(&ws);

    server.serveStatic("/", LittleFS, "/").setDefaultFile("dashboard.html");

    server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest *request) {
        captureAdminIp(request);
        bool is_ap_mode = (WiFi.getMode() == WIFI_AP) || (WiFi.getMode() == WIFI_AP_STA && WiFi.status() != WL_CONNECTED);
        String json = "{\"mqtt_connected\": true, \"is_ap_mode\": " + String(is_ap_mode ? "true" : "false") + "}"; 
        request->send(200, "application/json", json);
    });

    server.on("/toggle-pump", HTTP_GET, [](AsyncWebServerRequest *request) {
        captureAdminIp(request);
        String temp_state;
        bool has_param = request->hasParam("state");
        if (has_param) {
            temp_state = request->getParam("state")->value();
            temp_state.toUpperCase();
        }

        String current_state, current_mode;
        if (xSemaphoreTake(xMutexPumpControl, portMAX_DELAY) == pdTRUE) {
            if (has_param) {
                global_pump_state = temp_state;
            } else {
                global_pump_state = (global_pump_state == "ON") ? "OFF" : "ON";
            }
            
            global_pump_mode = "MANUAL";
            pump_manual_control = true;
            pump_manual_state = (global_pump_state == "ON");

            current_state = global_pump_state;
            current_mode = global_pump_mode;
            xSemaphoreGive(xMutexPumpControl);
        }

        Webserver_sendata("{\"pump_state\":\"" + current_state + "\",\"pump_mode\":\"" + current_mode + "\"}");

        if (s_ctx != nullptr) xSemaphoreGive(s_ctx->semDBUpdate);

        request->send(200, "text/plain", current_state);
    });

    server.on("/set-mode", HTTP_GET, [](AsyncWebServerRequest *request) {
        captureAdminIp(request);
        String temp_mode;
        bool has_param = request->hasParam("mode");
        if (has_param) {
            temp_mode = request->getParam("mode")->value();
            temp_mode.toUpperCase();
        }

        String current_state, current_mode;
        if (xSemaphoreTake(xMutexPumpControl, portMAX_DELAY) == pdTRUE) {
            if (has_param) {
                global_pump_mode = temp_mode;
            } else {
                global_pump_mode = (global_pump_mode == "MANUAL") ? "AUTO" : "MANUAL";
            }

            pump_manual_control = (global_pump_mode == "MANUAL");
            if (pump_manual_control) {
                pump_manual_state = (global_pump_state == "ON");
            }

            current_state = global_pump_state;
            current_mode = global_pump_mode;
            xSemaphoreGive(xMutexPumpControl);
        }

        Webserver_sendata("{\"pump_state\":\"" + current_state + "\",\"pump_mode\":\"" + current_mode + "\"}");

        if (s_ctx != nullptr) xSemaphoreGive(s_ctx->semDBUpdate);

        request->send(200, "text/plain", current_mode);
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