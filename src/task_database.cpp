#include "task_database.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include "serial_log.h"
#include "task_webserver.h"

#define DB_SEND_INTERVAL_MS 5000

static const char *DB_URL = "https://webhook.site/6e60a994-1fda-47db-baaf-2e9ffc566e51";

static String formatTimestamp(time_t t)
{
    if (t == 0) return "null";
    struct tm timeinfo;
    localtime_r(&t, &timeinfo);
    char buf[20];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &timeinfo);
    return String(buf);
}

void task_database(void *pvParameters)
{
    SharedContext *ctx = static_cast<SharedContext *>(pvParameters);

    while (1)
    {
        if (WiFi.status() != WL_CONNECTED)
        {
            vTaskDelay(pdMS_TO_TICKS(DB_SEND_INTERVAL_MS));
            continue;
        }

        float temperature = 0, humidity = 0;
        int soilMoisture = 0, ledState = 1, neoState = 1, lcdState = 1;
        int mlPredicted = 0;
        float mlConfidence = 0;
        time_t timestampReal = 0;
        String pumpState, modeState;

        if (ctx != NULL && xSemaphoreTake(ctx->mutexContext, pdMS_TO_TICKS(2000)) == pdTRUE)
        {
            temperature = ctx->temperature;
            humidity = ctx->humidity;
            soilMoisture = ctx->soilMoisture;
            ledState = ctx->ledState;
            neoState = ctx->neoState;
            lcdState = ctx->lcdState;
            mlPredicted = ctx->mlPredicted;
            mlConfidence = ctx->mlConfidence;
            timestampReal = ctx->timestampReal;
            xSemaphoreGive(ctx->mutexContext);
        }

        pumpState = global_pump_state;
        modeState = global_pump_mode;

        time_t timestampUp = time(nullptr);

        String payload = "{";
        payload += "\"timestamp_real\":\"" + formatTimestamp(timestampReal) + "\",";
        payload += "\"timestamp_up\":\"" + formatTimestamp(timestampUp) + "\",";
        payload += "\"temperature (°C)\":" + String(temperature, 2) + ",";
        payload += "\"humidity (%)\":" + String(humidity, 2) + ",";
        payload += "\"soil_moisture ()\":" + String(soilMoisture) + ",";
        payload += "\"PUMP_state\":\"" + pumpState + "\",";
        payload += "\"MODE_state\":\"" + modeState + "\",";
        payload += "\"s\":" + String(mlConfidence, 4) + ",";
        payload += "\"roll_acc\":null";
        payload += "}";

        HTTPClient http;
        http.begin(DB_URL);
        http.setTimeout(5000);
        http.addHeader("Content-Type", "application/json");

        int httpCode = http.POST(payload);

        serialLogLock();
        if (httpCode > 0)
            Serial.printf("[DB] POST -> %d\n", httpCode);
        else
            Serial.printf("[DB] POST failed: %s\n", http.errorToString(httpCode).c_str());
        serialLogUnlock();

        http.end();
        vTaskDelay(pdMS_TO_TICKS(DB_SEND_INTERVAL_MS));
    }
}