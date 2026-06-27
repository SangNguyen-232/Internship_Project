#include "temp_humi_monitor.h"
#include "risk_label.h"
#include "serial_log.h"

#define SOIL_PIN 1 // Khai báo trực tiếp chân Analog của cảm biến đất

DHT20 dht20;
LiquidCrystal_I2C lcd(0x27, 16, 2);

static const char* statusText(int state) {
    if (state == 3) return "Critical";
    if (state == 2) return "Warning";
    return "Normal";
}

void temp_humi_monitor(void *pvParameters) {

    Wire.begin(11, 12);
    Serial.begin(115200);
    dht20.begin();

    lcd.begin();
    lcd.backlight();
    lcd.clear();
    lcd.setCursor(1, 0);
    lcd.print("IOT ASSIGNMENT");
    delay(5000);
    lcd.clear();
    // lcd.setCursor(0, 1);
    // lcd.print("H:00%   Normal");

    while (1) {
        // 1. Đọc DHT20 qua I2C
        dht20.read();
        float temperature = dht20.getTemperature();
        float humidity = dht20.getHumidity();

        // 2. Đọc trực tiếp cảm biến đất qua Analog (Đơn giản và trực tiếp)
        int raw_soil = analogRead(SOIL_PIN);
        int soil_moisture = map(raw_soil, 4095, 0, 0, 100); // Đảo chiều 4095->0%, 0->100%
        soil_moisture = constrain(soil_moisture, 0, 100);   // Giới hạn giá trị chuẩn trong 0-100%

        // Kiểm tra lỗi DHT20
        if (isnan(temperature) || isnan(humidity)) {
            serialLogLock();
            Serial.println("Failed to read from DHT sensor!");
            serialLogUnlock();
            temperature = humidity = -1;
        }

        glob_temperature = temperature;
        glob_humidity = humidity;

        if (pvParameters != NULL) {
            SharedContext* ctx = (SharedContext*)pvParameters;
            xSemaphoreTake(ctx->mutexContext, portMAX_DELAY);
            ctx->temperature = temperature;
            ctx->humidity = humidity;
            
            const int newLedState = risk_led_state_from_temperature(temperature);
            if (newLedState != ctx->ledState) {
                ctx->ledState = newLedState;
                xSemaphoreGive(ctx->semLEDUpdate);
            }

            const int newNeoState = risk_neo_state_from_humidity(humidity);
            if (newNeoState != ctx->neoState) {
                ctx->neoState = newNeoState;
                xSemaphoreGive(ctx->semNeoUpdate);
            }

            const int newLcdState = risk_final_label(temperature, humidity);
            if (newLcdState != ctx->lcdState) {
                ctx->lcdState = newLcdState;
                xSemaphoreGive(ctx->semLCDUpdate);
            }
            
            xSemaphoreGive(ctx->mutexContext);
        }

        lcd.setCursor(0, 0);
        lcd.print("T:");
        lcd.print(temperature, 1);
        lcd.print((char)223);
        lcd.print("C H:");
        
        // Sửa lỗi hiển thị H:100.0 bằng cách chặn từ ngưỡng làm tròn 99.95
        if (humidity >= 99.99) {
            lcd.print("100% "); // Có dấu cách ở cuối để xóa sạch ký tự cũ nếu có
        } else {
            lcd.print(humidity, 1);
            lcd.print("%");
        }

        // Hiển thị LCD
        if (pvParameters != NULL) {
            SharedContext* ctx = (SharedContext*)pvParameters;
            if (xSemaphoreTake(ctx->semLCDUpdate, 0) == pdTRUE) {
                lcd.setCursor(0, 1);
                char buffer[10];
                snprintf(buffer, sizeof(buffer), "SM:%02d%%   ", soil_moisture);
                lcd.print(buffer);
                lcd.print("        ");
                lcd.setCursor(8, 1);
                lcd.print(statusText(ctx->lcdState));
            }
        }
        
        vTaskDelay(5000);
    }

}
