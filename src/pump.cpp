#include "pump.h"
#include "global.h"
#include "task_webserver.h"   

#define PUMP_PIN 10
#define PUMP_SOIL_THRESHOLD 5

bool pump_manual_control = false;
bool pump_manual_state = false;
SemaphoreHandle_t xMutexPumpControl = xSemaphoreCreateMutex();

void task_pump(void *pvParameters)
{
    SharedContext* ctx = (SharedContext*)pvParameters;

    pinMode(PUMP_PIN, OUTPUT);
    digitalWrite(PUMP_PIN, LOW);

    bool last_reported_state = false;   

    while (1) {
        int current_soil = 0;
        if (ctx != NULL) {
            if (xSemaphoreTake(ctx->mutexContext, pdMS_TO_TICKS(200)) == pdTRUE) {
                current_soil = ctx->soilMoisture;
                xSemaphoreGive(ctx->mutexContext);
            }
        }

        bool current_manual_control = false;
        bool current_manual_state = false;
        if (xSemaphoreTake(xMutexPumpControl, pdMS_TO_TICKS(200)) == pdTRUE) {
            current_manual_control = pump_manual_control;
            current_manual_state = pump_manual_state;
            xSemaphoreGive(xMutexPumpControl);
        }

        bool new_state;
        if (current_manual_control) {
            new_state = current_manual_state;
        } else {
            new_state = (current_soil < PUMP_SOIL_THRESHOLD);
        }

        digitalWrite(PUMP_PIN, new_state ? HIGH : LOW);

        if (new_state != last_reported_state) {
            last_reported_state = new_state;

            String modeStr;
            if (xSemaphoreTake(xMutexPumpControl, pdMS_TO_TICKS(200)) == pdTRUE) {
                global_pump_state = new_state ? "ON" : "OFF";
                modeStr = global_pump_mode;
                xSemaphoreGive(xMutexPumpControl);
            }

            String wsPayload = "{\"pump_state\":\"" + String(new_state ? "ON" : "OFF") +
                                "\",\"pump_mode\":\"" + modeStr + "\"}";
            Webserver_sendata(wsPayload);
        }

        vTaskDelay(500 / portTICK_PERIOD_MS);
    }
}