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
    if (wifiCredentialCount == 0)
    {
        vTaskDelete(NULL);
    }

    WiFi.mode(WIFI_STA);

    for (int i = 0; i < wifiCredentialCount; i++)
    {
        const String &ssid = wifiCredentials[i].ssid;
        const String &pass = wifiCredentials[i].pass;
        if (ssid.isEmpty()) continue;

        if (pass.isEmpty())
            WiFi.begin(ssid.c_str());
        else
            WiFi.begin(ssid.c_str(), pass.c_str());

        unsigned long start = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - start < 10000)
        {
            vTaskDelay(100 / portTICK_PERIOD_MS);
        }

        if (WiFi.status() == WL_CONNECTED) break;
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
