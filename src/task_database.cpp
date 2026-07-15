#include "task_database.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include "serial_log.h"
#include "task_webserver.h"
#include "pump.h"

static String formatTimestamp(time_t t)
{
    if (t == 0) return "null";
    struct tm timeinfo;
    localtime_r(&t, &timeinfo);
    char buf[20];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &timeinfo);
    return String(buf);
}

// Derive rule-based status label from lcdState (1=Normal, 2=Warning, 3=Critical)
static const char* ruleStatusLabel(int lcdState)
{
    if (lcdState == 3) return "Critical";
    if (lcdState == 2) return "Warning";
    return "Normal";
}

void task_database(void *pvParameters)
{
    SharedContext *ctx = static_cast<SharedContext *>(pvParameters);

    while (1)
    {
        xSemaphoreTake(ctx->semDBUpdate, portMAX_DELAY);

        vTaskDelay(200 / portTICK_PERIOD_MS);

        if (WiFi.status() != WL_CONNECTED)
        {
            continue;
        }

        if (global_admin_ip.isEmpty())
        {
            serialLogLock();
            Serial.println("[DB] Chưa có IP admin.");
            serialLogUnlock();
            continue;
        }

        float temperature = 0, humidity = 0;
        int soilMoisture = 0, lcdState = 1;
        float mlRollAcc = 0;
        time_t timestampReal = 0;
        String pumpState, modeState;

        if (ctx != NULL && xSemaphoreTake(ctx->mutexContext, pdMS_TO_TICKS(2000)) == pdTRUE)
        {
            temperature    = ctx->temperature;
            humidity       = ctx->humidity;
            soilMoisture   = ctx->soilMoisture;
            lcdState       = ctx->lcdState;       // risk_final_label(t, h, soil)
            mlRollAcc      = ctx->mlRollAcc;
            timestampReal  = ctx->timestampReal;
            xSemaphoreGive(ctx->mutexContext);
        }

        if (xSemaphoreTake(xMutexPumpControl, pdMS_TO_TICKS(2000)) == pdTRUE) {
            pumpState = global_pump_state;
            modeState = global_pump_mode;
            xSemaphoreGive(xMutexPumpControl);
        }

        time_t timestampUp = time(nullptr);

        String payload = "{\n";
        payload += "  \"timestamp_real\":\"" + formatTimestamp(timestampReal) + "\",\n";
        payload += "  \"timestamp_up\":\"" + formatTimestamp(timestampUp) + "\",\n";
        payload += "  \"temperature\":\"" + String(temperature, 2) + "°C\",\n";
        payload += "  \"humidity\":\"" + String(humidity, 2) + "%\",\n";
        char soilBuf[8];
        snprintf(soilBuf, sizeof(soilBuf), "%02d", soilMoisture);
        payload += "  \"soil_moisture\":\"" + String(soilBuf) + "%\",\n";
        payload += "  \"PUMP_state\":\"" + pumpState + "\",\n";
        payload += "  \"MODE_state\":\"" + modeState + "\",\n";
        payload += "  \"Message\":\"" + String(ruleStatusLabel(lcdState)) + "\",\n";  // rule-based: max(temp, humi, soil)
        payload += "  \"Score\":\"" + String(mlRollAcc >= 100.0f ? "100" : String(mlRollAcc, 2)) + "%\",\n";
        payload += "  \"device_id\":\"" + WiFi.localIP().toString() + "\"\n";
        payload += "}";

        String dbUrl = "http://" + global_admin_ip + ":3000/sensor";

        HTTPClient http;
        http.begin(dbUrl);
        http.setTimeout(5000);
        http.addHeader("Content-Type", "application/json");

        int httpCode = http.POST(payload);

        serialLogLock();
        if (httpCode > 0)
            Serial.printf("[DB] POST thành công -> %d\n", httpCode);
        else
            Serial.printf("[DB] POST thất bại: %s\n", http.errorToString(httpCode).c_str());
        serialLogUnlock();
        http.end();
    }
}