#ifndef __PUMP__
#define __PUMP__

#include "Wire.h"
#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

extern bool pump_manual_control;   // true = MANUAL, false = AUTO
extern bool pump_manual_state;     // Trạng thái bơm do người dùng chọn khi ở MANUAL (ON/OFF)
extern SemaphoreHandle_t xMutexPumpControl;

void task_pump(void *pvParameters);

#endif