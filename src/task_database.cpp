#include "task_database.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include "serial_log.h"

// Khoảng thời gian giữa 2 lần gửi dữ liệu lên server (ms)
#define DB_SEND_INTERVAL_MS 10000

// ====== CẤU HÌNH BACKEND ======
// Tái sử dụng 3 trường đã có sẵn trong Settings (trước đây dùng cho CoreIoT/ThingsBoard):
//   CORE_IOT_SERVER -> host/IP backend của bạn   (ví dụ: "192.168.1.10" hoặc "myapi.example.com")
//   CORE_IOT_PORT   -> cổng backend              (ví dụ: "3000")
//   CORE_IOT_TOKEN  -> API key / device token để xác thực request
// Không cần sửa form Settings hay cơ chế lưu LittleFS, chỉ đổi Ý NGHĨA của 3 trường này.
// TODO: đổi đường dẫn endpoint dưới đây cho khớp với API thật của bạn.
static const char *DB_ENDPOINT_PATH = "/api/telemetry";

void task_database(void *pvParameters)
{
    SharedContext *ctx = static_cast<SharedContext *>(pvParameters);

    while (1)
    {
        // Chỉ gửi khi ESP32 đang ở STA mode, đã có Internet, và đã cấu hình server
        if (WiFi.status() != WL_CONNECTED || CORE_IOT_SERVER.isEmpty())
        {
            vTaskDelay(pdMS_TO_TICKS(DB_SEND_INTERVAL_MS));
            continue;
        }

        // ---- Đọc dữ liệu mới nhất từ SharedContext (có mutex) ----
        float temperature = 0, humidity = 0;
        int ledState = 1, neoState = 1, lcdState = 1;
        int mlPredicted = 0;
        float mlConfidence = 0;

        if (ctx != NULL && xSemaphoreTake(ctx->mutexContext, pdMS_TO_TICKS(2000)) == pdTRUE)
        {
            temperature = ctx->temperature;
            humidity = ctx->humidity;
            ledState = ctx->ledState;
            neoState = ctx->neoState;
            lcdState = ctx->lcdState;
            mlPredicted = ctx->mlPredicted;
            mlConfidence = ctx->mlConfidence;
            xSemaphoreGive(ctx->mutexContext);
        }

        // ---- Dựng URL: http://<server>:<port><path> ----
        String port = CORE_IOT_PORT.isEmpty() ? "80" : CORE_IOT_PORT;
        String url = "http://" + CORE_IOT_SERVER + ":" + port + DB_ENDPOINT_PATH;

        // ---- Payload JSON ----
        // TODO: đổi tên field cho khớp schema dataPbase thật của bạn
        String payload = "{";
        payload += "\"device_token\":\"" + CORE_IOT_TOKEN + "\",";
        payload += "\"temperature\":" + String(temperature, 2) + ",";
        payload += "\"humidity\":" + String(humidity, 2) + ",";
        payload += "\"led_state\":" + String(ledState) + ",";
        payload += "\"neo_state\":" + String(neoState) + ",";
        payload += "\"lcd_state\":" + String(lcdState) + ",";
        payload += "\"ml_predicted\":" + String(mlPredicted) + ",";
        payload += "\"ml_confidence\":" + String(mlConfidence, 3);
        payload += "}";

        HTTPClient http;
        http.setTimeout(5000);
        http.begin(url);
        http.addHeader("Content-Type", "application/json");
        // Nếu backend dùng Bearer token trong header thay vì field trong body, mở comment dòng dưới:
        // http.addHeader("Authorization", "Bearer " + CORE_IOT_TOKEN);

        int httpCode = http.POST(payload);

        serialLogLock();
        if (httpCode > 0)
        {
            Serial.printf("[DB] POST %s -> %d\n", url.c_str(), httpCode);
        }
        else
        {
            Serial.printf("[DB] POST failed: %s\n", http.errorToString(httpCode).c_str());
        }
        serialLogUnlock();

        http.end();

        vTaskDelay(pdMS_TO_TICKS(DB_SEND_INTERVAL_MS));
    }
}
