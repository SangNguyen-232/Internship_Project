#include "task_check_info.h"
#include "esp_log.h"

void Load_info_File()
{
  if (!LittleFS.exists("/info.dat")) return;

  File file = LittleFS.open("/info.dat", "r");
  if (!file) return;

  DynamicJsonDocument doc(512);
  DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error) return;

  wifi_ssid = doc["WIFI_SSID"].as<String>();
  wifi_pass = doc["WIFI_PASS"].as<String>();
}

void Delete_info_File()
{
  if (LittleFS.exists("/info.dat"))
  {
    LittleFS.remove("/info.dat");
  }

  File wifiFile = LittleFS.open("/wifi_info.json", "w");
  if (wifiFile)
  {
    wifiFile.print("{}");
    wifiFile.close();
  }

  Serial.println("The device has been successfully reset.");
  Serial.flush();
  delay(100);
  ESP.restart();
}

void Save_info_File(String ssid, String pass)
{
  wifi_ssid = ssid;
  wifi_pass = pass;

  DynamicJsonDocument doc(512);
  doc["WIFI_SSID"] = ssid;
  doc["WIFI_PASS"] = pass;

  File configFile = LittleFS.open("/info.dat", "w");
  if (configFile)
  {
    serializeJson(doc, configFile);
    configFile.close();
  }
  ESP.restart();
}

bool check_info_File(bool check)
{
  if (!check)
  {
    if (!LittleFS.begin(true))
    {
      return false;
    }
    Load_info_File();
  }

  if (wifi_ssid.isEmpty())
  {
    if (!check)
    {
      startAP();
    }
    return false;
  }
  return true;
}