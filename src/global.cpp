#include "global.h"

float glob_temperature = 0;
float glob_humidity = 0;
float glob_soil = 0;

WifiCredential wifiCredentials[WIFI_MAX_CREDENTIALS];
int wifiCredentialCount = 0;

String ssid = "ESP32-YOUR NETWORK HERE!!!";
String password = "12345678";
String wifi_ssid = "abcde";
String wifi_password = "123456789";
boolean isWifiConnected = false;
SemaphoreHandle_t xBinarySemaphoreInternet = xSemaphoreCreateBinary();