#include "tinyml.h"
#include "risk_label.h"
#include "serial_log.h"

#include <math.h>

namespace
{
    tflite::ErrorReporter *error_reporter = nullptr;
    const tflite::Model *model = nullptr;
    tflite::MicroInterpreter *interpreter = nullptr;
    TfLiteTensor *input = nullptr;
    TfLiteTensor *output = nullptr;
    constexpr int kTensorArenaSize = 16 * 1024;
    uint8_t tensor_arena[kTensorArenaSize];
    bool s_tinyml_ready = false;

    int tensor_element_count(const TfLiteTensor *tensor)
    {
        int n = 1;
        for (int i = 0; i < tensor->dims->size; ++i)
            n *= tensor->dims->data[i];
        return n;
    }

    int argmax_float(const float *p, int n)
    {
        int best = 0;
        for (int i = 1; i < n; ++i)
        {
            if (p[i] > p[best])
                best = i;
        }
        return best;
    }
} // namespace

void setupTinyML()
{
    s_tinyml_ready = false;
    serialLogLock();
    Serial.println("TensorFlow Lite Init....");
    serialLogUnlock();
    static tflite::MicroErrorReporter micro_error_reporter;
    error_reporter = &micro_error_reporter;

    model = tflite::GetModel(dht_anomaly_model_tflite);
    if (model->version() != TFLITE_SCHEMA_VERSION)
    {
        error_reporter->Report("Model schema version %d != supported %d.",
                               model->version(), TFLITE_SCHEMA_VERSION);
        return;
    }

    static tflite::AllOpsResolver resolver;
    static tflite::MicroInterpreter static_interpreter(
        model, resolver, tensor_arena, kTensorArenaSize, error_reporter);
    interpreter = &static_interpreter;

    if (interpreter->AllocateTensors() != kTfLiteOk)
    {
        error_reporter->Report("AllocateTensors() failed");
        return;
    }

    input = interpreter->input(0);
    output = interpreter->output(0);

    if (!input || !output || input->type != kTfLiteFloat32 || output->type != kTfLiteFloat32)
    {
        error_reporter->Report("TinyML: expected float32 input/output");
        return;
    }
    if (tensor_element_count(input) != 2 || tensor_element_count(output) != 3)
    {
        error_reporter->Report("TinyML: need input 2 floats, output 3 (softmax). Re-run ml/train_export.py");
        return;
    }

    s_tinyml_ready = true;
    serialLogLock();
    Serial.println("TensorFlow Lite Micro initialized on ESP32.");
    serialLogUnlock();
}

void tiny_ml_task(void *pvParameters)
{
    SharedContext *ctx = static_cast<SharedContext *>(pvParameters);
    if (!ctx)
    {
        serialLogLock();
        Serial.println("TinyML: SharedContext is null; task stopped.");
        serialLogUnlock();
        vTaskDelete(nullptr);
        return;
    }

    setupTinyML();
    if (!s_tinyml_ready)
    {
        serialLogLock();
        Serial.println("TinyML: setup failed; task stopped.");
        serialLogUnlock();
        vTaskDelete(nullptr);
        return;
    }

    unsigned long inferences = 0;
    unsigned long correct = 0;

    while (1)
    {
        float temperature = 0.0f;
        float humidity = 0.0f;

        if (xSemaphoreTake(ctx->mutexContext, pdMS_TO_TICKS(2000)) == pdTRUE)
        {
            temperature = ctx->temperature;
            humidity = ctx->humidity;
            xSemaphoreGive(ctx->mutexContext);
        }

        if (isnan(temperature) || isnan(humidity) || temperature < 0.0f || humidity < 0.0f)
        {
            serialLogLock();
            Serial.println("TinyML: skip (invalid DHT reading)");
            serialLogUnlock();
            vTaskDelay(pdMS_TO_TICKS(5000));
            continue;
        }

        input->data.f[0] = temperature;
        input->data.f[1] = humidity;

        const unsigned long t0 = millis();
        if (interpreter->Invoke() != kTfLiteOk)
        {
            error_reporter->Report("Invoke failed");
            vTaskDelay(pdMS_TO_TICKS(5000));
            continue;
        }
        const unsigned long t1 = millis();

        const int nout = tensor_element_count(output);
        const int best = argmax_float(output->data.f, nout);
        const int predicted = best + 1; // model classes 0..2 -> labels 1..3
        const int expected = risk_final_label(temperature, humidity);

        if (xSemaphoreTake(ctx->mutexContext, pdMS_TO_TICKS(200)) == pdTRUE)
        {
            ctx->mlPredicted = predicted;
            ctx->mlConfidence = output->data.f[best];
            xSemaphoreGive(ctx->mutexContext);
        }

        if (predicted == expected)
            correct++;
        inferences++;

        // Logic thêm chữ Normal / Warning / Critical
        const char* status = "Mismatch"; 
        if (expected == predicted) {
            if (expected == 1) status = "Normal";
            else if (expected == 2) status = "Warning";
            else if (expected == 3) status = "Critical";
        }

        serialLogLock();
        Serial.printf("TinyML T=%.1f°C H=%.1f%% | rule=%d pred=%d | %s | p=[%.2f,%.2f,%.2f] | %lums | roll_acc=%.1f%% (%lu/%lu)\n",
                      temperature, humidity, expected, predicted,
                      status,
                      output->data.f[0], output->data.f[1], output->data.f[2],
                      (unsigned long)(t1 - t0),
                      inferences ? (100.0f * (float)correct / (float)inferences) : 0.0f,
                      correct, inferences);
        serialLogUnlock();

        vTaskDelay(pdMS_TO_TICKS(5000));
    }
}
