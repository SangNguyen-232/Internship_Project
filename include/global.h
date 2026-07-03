#ifndef __GLOBAL_H__
#define __GLOBAL_H__

#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

struct SharedContext {
    float temperature;
    float humidity;
    int soilMoisture;
    int soilRaw;
    SemaphoreHandle_t mutexContext;
    SemaphoreHandle_t semLEDUpdate;
    int ledState; // 1: Normal, 2: Warning, 3: Critical
    SemaphoreHandle_t semNeoUpdate;
    int neoState;
    SemaphoreHandle_t semLCDUpdate;
    int lcdState;
    int mlPredicted;     // 1=Normal, 2=Warning, 3=Critical (nhãn TinyML dự đoán)
    float mlConfidence;  // độ tin cậy 0..1 của nhãn dự đoán
    time_t timestampReal;        // thời gian dự đoán
    char mlStatus[16];
    float mlRollAcc;
};

extern float glob_temperature;
extern float glob_humidity;
extern float glob_soil;

extern String WIFI_SSID;
extern String WIFI_PASS;

extern boolean isWifiConnected;
extern SemaphoreHandle_t xBinarySemaphoreInternet;
#endif
