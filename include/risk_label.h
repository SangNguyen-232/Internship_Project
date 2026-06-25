#ifndef RISK_LABEL_H
#define RISK_LABEL_H

/** Rule-based states aligned with firmware thresholds (1=Normal, 2=Warning, 3=Critical). */
static inline int risk_led_state_from_temperature(float temperature)
{
    if (temperature >= 30.0f)
        return 3;
    if (temperature >= 25.0f)
        return 2;
    return 1;
}

static inline int risk_neo_state_from_humidity(float humidity)
{
    if (humidity >= 70.0f)
        return 3;
    if (humidity >= 50.0f)
        return 2;
    return 1;
}

/** Worst-case label used for LCD / TinyML ground truth (max of temp and humidity bands). */
static inline int risk_final_label(float temperature, float humidity)
{
    const int led = risk_led_state_from_temperature(temperature);
    const int neo = risk_neo_state_from_humidity(humidity);
    return (led > neo) ? led : neo;
}

#endif
