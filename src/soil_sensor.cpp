// #include "soil_sensor.h"
// #include "global.h"  
// #define SOIL_PIN 1

// void task_soil_sensor(void *pvParameters) {
//     Wire.begin(11, 12);
//     while (1) {
//         int rawValue = analogRead(SOIL_PIN);
//         float new_soil = map(rawValue, 0, 4095, 0, 100);
//         if (xSemaphoreTake(xMutexSensorData, portMAX_DELAY) == pdTRUE) {
//             glob_soil = new_soil;
//             xSemaphoreGive(xMutexSensorData);
//         }
//         vTaskDelay(3000 / portTICK_PERIOD_MS);  
//     }
// }