#ifndef RISK_LABEL_H
#define RISK_LABEL_H

static inline int risk_led_state_from_temperature(float temperature)
{
    if (temperature >= 50.0f)
        return 3;
    if (temperature >= 35.0f)
        return 2;
    return 1;
}

static inline int risk_neo_state_from_humidity(float humidity)
{
    if (humidity >= 95.0f)
        return 3;
    if (humidity >= 75.0f)
        return 2;
    return 1;
}

static inline int risk_soil_state_from_moisture(float soil_moisture)
{
    if (soil_moisture < 20.0f || soil_moisture > 90.0f)
        return 3;
    if (soil_moisture < 40.0f || soil_moisture > 80.0f)
        return 2;
    return 1;
}

static inline int risk_final_label(float temperature, float humidity, float soil_moisture)
{
    const int led  = risk_led_state_from_temperature(temperature);
    const int neo  = risk_neo_state_from_humidity(humidity);
    const int soil = risk_soil_state_from_moisture(soil_moisture);
    return (led > neo) ? ((led > soil) ? led : soil)
                       : ((neo > soil) ? neo : soil);
}

#endif