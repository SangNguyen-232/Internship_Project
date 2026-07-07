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
    int ledState;
    SemaphoreHandle_t semNeoUpdate;
    int neoState;
    SemaphoreHandle_t semLCDUpdate;
    int lcdState;
    SemaphoreHandle_t semDBUpdate;
    int mlPredicted;
    float mlConfidence;
    time_t timestampReal;
    char mlStatus[16];
    float mlRollAcc;
};

extern float glob_temperature;
extern float glob_humidity;
extern float glob_soil;

extern String wifi_ssid;
extern String wifi_pass;

extern boolean isWifiConnected;
extern SemaphoreHandle_t xBinarySemaphoreInternet;

#endif