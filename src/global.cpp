#include "global.h"

float glob_temperature = 0;
float glob_humidity = 0;
float glob_soil = 0;

String wifi_ssid = "";
String wifi_pass = "";

boolean isWifiConnected = false;
SemaphoreHandle_t xBinarySemaphoreInternet = xSemaphoreCreateBinary();