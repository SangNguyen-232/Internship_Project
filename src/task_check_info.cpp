#include "task_check_info.h"
#include "esp_log.h"

void Load_info_File()
{
  bool exists = LittleFS.exists("/info.dat");
  if (!exists) return;

  File file = LittleFS.open("/info.dat", "r");
  if (!file) return;

  DynamicJsonDocument doc(4096);
  DeserializationError error = deserializeJson(doc, file);
  if (error) { file.close(); return; }

  wifiCredentialCount = 0;
  for (JsonObject obj : doc.as<JsonArray>())
  {
    if (wifiCredentialCount >= WIFI_MAX_CREDENTIALS) break;
    wifiCredentials[wifiCredentialCount].ssid = obj["WIFI_SSID"].as<String>();
    wifiCredentials[wifiCredentialCount].pass = obj["WIFI_PASS"].as<String>();
    wifiCredentialCount++;
  }
  file.close();
}

void Delete_info_File()
{
  if (LittleFS.exists("/info.dat"))
  {
    LittleFS.remove("/info.dat");
  }

  Serial.println("The device has been successfully reset.");
  Serial.flush();
  delay(100);
  ESP.restart();
}

void Save_info_File(String wifi_ssid, String wifi_pass)
{
  Serial.println(wifi_ssid);
  Serial.println(wifi_pass);

  int idx = -1;
  for (int i = 0; i < wifiCredentialCount; i++)
  {
    if (wifiCredentials[i].ssid == wifi_ssid) { idx = i; break; }
  }
  if (idx >= 0)
  {
    for (int i = idx; i < wifiCredentialCount - 1; i++)
      wifiCredentials[i] = wifiCredentials[i + 1];
    wifiCredentialCount--;
  }

  int keep = wifiCredentialCount;
  if (keep >= WIFI_MAX_CREDENTIALS)
    keep = WIFI_MAX_CREDENTIALS - 1; 

  for (int i = keep; i > 0; i--)
    wifiCredentials[i] = wifiCredentials[i - 1];

  wifiCredentials[0].ssid = wifi_ssid;
  wifiCredentials[0].pass = wifi_pass;
  wifiCredentialCount = keep + 1;

  DynamicJsonDocument doc(4096);
  JsonArray arr = doc.to<JsonArray>();
  for (int i = 0; i < wifiCredentialCount; i++)
  {
    JsonObject obj = arr.createNestedObject();
    obj["WIFI_SSID"] = wifiCredentials[i].ssid;
    obj["WIFI_PASS"] = wifiCredentials[i].pass;
  }

  File configFile = LittleFS.open("/info.dat", "w");
  if (configFile)
  {
    serializeJson(doc, configFile);
    configFile.close();
  }
  ESP.restart();
};

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

  if (wifiCredentialCount == 0)
  {
    if (!check)
    {
      startAP();
    }
    return false;
  }
  return true;
}