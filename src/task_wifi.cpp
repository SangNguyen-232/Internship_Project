#include "task_wifi.h"

void startAP()
{
    WiFi.mode(WIFI_AP);
    WiFi.softAP(String(SSID_AP), String(PASS_AP));
    Serial.print("AP IP: ");
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

    Serial.print("STA IP address: ");
    Serial.println(WiFi.localIP());

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