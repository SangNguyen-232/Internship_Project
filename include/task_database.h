#ifndef __TASK_DATABASE_H__
#define __TASK_DATABASE_H__

#include <Arduino.h>
#include "global.h"

// Task gửi dữ liệu cảm biến (temperature/humidity/ML...) lên server
// qua HTTP POST, để backend của bạn lưu vào database.
// Thay thế hoàn toàn cho task_iot (coreiot.cpp / task_core_iot.cpp) cũ.
void task_database(void *pvParameters);

#endif
