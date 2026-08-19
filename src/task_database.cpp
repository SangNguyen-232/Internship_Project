#include "task_database.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "serial_log.h"
#include "task_webserver.h"
#include "pump.h"
#include <sys/time.h>

static String formatTimestamp(time_t t)
{
    if (t == 0) return "null";
    struct tm timeinfo;
    localtime_r(&t, &timeinfo);
    char buf[20];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &timeinfo);
    return String(buf);
}

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

        char triggerSource[8] = "sensor";
        if (ctx != NULL && xSemaphoreTake(ctx->mutexContext, pdMS_TO_TICKS(200)) == pdTRUE)
        {
            strncpy(triggerSource, ctx->dbTriggerSource, sizeof(triggerSource) - 1);
            triggerSource[sizeof(triggerSource) - 1] = '\0';
            xSemaphoreGive(ctx->mutexContext);
        }

        // Debounce: sensor 200ms, pump 1000ms
        {
            unsigned long minGap      = 200UL;
            unsigned long lastPostMs  = (strcmp(triggerSource, "pump") == 0)
                                        ? g_lastDBPostMs_pump
                                        : g_lastDBPostMs_sensor;
            if (millis() - lastPostMs < minGap)
            {
                continue;
            }

            if (strcmp(triggerSource, "pump") == 0)
            {
                g_pumpEventPending = false;  
            }

            if (strcmp(triggerSource, "sensor") == 0 &&
                (g_pumpEventPending || millis() - g_lastDBPostMs_pump < 200UL))
            {
                continue;
            }
        }

        if (WiFi.status() != WL_CONNECTED)
        {
            continue;
        }

        float temperature = 0.0f;
        float humidity = 0.0f;
        int soilMoisture = 0;
        int lcdState = 1;
        float mlRollAcc = 0.0f;
        struct timeval tvReal = {0, 0};
        struct timeval tvUp   = {0, 0};
        String pumpState;
        String modeState;

        if (ctx != NULL && xSemaphoreTake(ctx->mutexContext, pdMS_TO_TICKS(2000)) == pdTRUE)
        {
            temperature    = ctx->temperature;
            humidity       = ctx->humidity;
            soilMoisture   = ctx->soilMoisture;
            lcdState       = ctx->lcdState;
            mlRollAcc      = ctx->mlRollAcc;
            tvReal.tv_sec  = ctx->timestampReal;
            tvReal.tv_usec = ctx->timestampRealUs;
            xSemaphoreGive(ctx->mutexContext);
        }

        if (xSemaphoreTake(xMutexPumpControl, pdMS_TO_TICKS(2000)) == pdTRUE)
        {
            pumpState = global_pump_state;
            modeState = global_pump_mode;
            xSemaphoreGive(xMutexPumpControl);
        }

        gettimeofday(&tvUp, nullptr);

        int64_t latencyUs = (((int64_t)tvUp.tv_sec  * 1000000LL + tvUp.tv_usec)
                        - ((int64_t)tvReal.tv_sec * 1000000LL + tvReal.tv_usec));

        String scoreStr;
        if (mlRollAcc >= 100.0f)
        {
            scoreStr = "100";
        }
        else
        {
            scoreStr = String(mlRollAcc, 2);
        }

        String payload = "{\n";
        payload += "  \"timestamp_real\":\"" + formatTimestamp(tvReal.tv_sec) + "\",\n";
        payload += "  \"timestamp_up\":\"" + formatTimestamp(tvUp.tv_sec) + "\",\n";
        payload += "  \"temperature\":\"" + String(temperature, 2) + "\\u00B0C\",\n";
        payload += "  \"humidity\":\"" + String(humidity, 2) + "%\",\n";
        char soilBuf[8];
        snprintf(soilBuf, sizeof(soilBuf), "%02d", soilMoisture);
        payload += "  \"soil_moisture\":\"" + String(soilBuf) + "%\",\n";
        payload += "  \"PUMP_state\":\"" + pumpState + "\",\n";
        payload += "  \"MODE_state\":\"" + modeState + "\",\n";
        payload += "  \"Message\":\"" + String(ruleStatusLabel(lcdState)) + "\",\n";
        payload += "  \"Score\":\"" + scoreStr + "%\",\n";
        payload += "  \"device_id\":\"" + WiFi.localIP().toString() + "\",\n";
        payload += "  \"latency\":" + String((long long)latencyUs) + ",\n";
        payload += "  \"trigger_source\":\"" + String(triggerSource) + "\"\n";
        payload += "}";

        String dbUrl = "https://whose-gets-sky-camera.trycloudflare.com/sensor";

        WiFiClientSecure client;
        client.setInsecure();
        HTTPClient http;
        http.begin(client, dbUrl);
        http.setTimeout(10000);
        http.addHeader("Content-Type", "application/json");

        int httpCode = http.POST(payload);

        serialLogLock();
        if (httpCode > 0)
        {
            Serial.printf("[DB] POST thành công -> %d\n", httpCode);
        }
        else
        {
            Serial.printf("[DB] POST thất bại: %s\n", http.errorToString(httpCode).c_str());
        }
        serialLogUnlock();

        http.end();
        if (strcmp(triggerSource, "pump") == 0)
            g_lastDBPostMs_pump   = millis();
        else
            g_lastDBPostMs_sensor = millis();
    }
}