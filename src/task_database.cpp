#include "task_database.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include "serial_log.h"

#define DB_SEND_INTERVAL_MS 5000

// // ====== CẤU HÌNH SUPABASE (đang không dùng, để test bằng webhook.site) ======
// static const char *SUPABASE_URL = "https://xxxxx.supabase.co/rest/v1/telemetry";
// static const char *SUPABASE_API_KEY = "eyJhbGciOi..."; // anon public key

static const char *DB_URL = "https://webhook.site/2e806367-7dbb-42c5-8b15-08e6b0c8ed84";
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
            xSemaphoreGive(ctx->mutexContext);
        }

        String payload = "{";
        payload += "\"temperature\":" + String(temperature, 2) + "°C ,";
        payload += "\"humidity\":" + String(humidity, 2) + "% ,";
        payload += "\"soil_moisture\":" + String(soilMoisture, 2) + "% ,";
        // payload += "\"led_state\":" + String(ledState) + ",";
        // payload += "\"neo_state\":" + String(neoState) + ",";
        // payload += "\"lcd_state\":" + String(lcdState) + ",";
        // payload += "\"ml_predicted\":" + String(mlPredicted) + ",";
        // payload += "\"ml_confidence\":" + String(mlConfidence, 3);
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