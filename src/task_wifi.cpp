#include "task_wifi.h"

void startAP()
{
    WiFi.mode(WIFI_AP);
    WiFi.softAP(String(SSID_AP), String(PASS_AP));
    Serial.print("Địa chỉ IP chế độ AP Mode: ");
    Serial.println(WiFi.softAPIP());
}

void startSTA()
{
    if (wifi_ssid.isEmpty())
    {
        vTaskDelete(NULL);
    }

    WiFi.mode(WIFI_STA);

    if (wifi_pass.isEmpty())
        WiFi.begin(wifi_ssid.c_str());
    else
        WiFi.begin(wifi_ssid.c_str(), wifi_pass.c_str());

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 10000)
    {
        vTaskDelay(100 / portTICK_PERIOD_MS);
    }

    if (WiFi.status() != WL_CONNECTED)
    {
        vTaskDelete(NULL);
    }

    Serial.print("Địa chỉ IP chế độ STA Mode: ");
    Serial.println(WiFi.localIP());

    Save_sta_ip_File(WiFi.localIP().toString());

    configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");

    xSemaphoreGive(xBinarySemaphoreInternet);
}

bool Wifi_reconnect()
{
    const wl_status_t status = WiFi.status();
    if (status == WL_CONNECTED)
    {
        return true;
    }
    startSTA();
    return false;
}

void Wifi_switch_to(const String& ssid, const String& pass) {
    Save_wifi_to_list(ssid, pass);
    Save_info_NoRestart(ssid, pass);
    WiFi.disconnect(true);
    vTaskDelay(pdMS_TO_TICKS(500));
    startSTA();
}