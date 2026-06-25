# IoT Project Assignment - Task 5: TinyML Deployment & Accuracy Evaluation

## Overview

Task 5 implements TensorFlow Lite (TinyML) model deployment on an ESP32-S3 microcontroller for real-time environmental risk assessment. The system trains a neural network model on environmental sensor data (temperature and humidity), deploys it as an optimized TFLite model on the edge device, and continuously evaluates its prediction accuracy against rule-based ground truth labels.

---

## Task 5: TinyML Deployment & Accuracy Evaluation

### Objective

Deploy a TensorFlow Lite neural network model on the ESP32-S3 microcontroller to predict environmental risk levels based on temperature and humidity sensor readings. Evaluate the model's real-time accuracy by comparing predictions against rule-based ground truth labels and report performance metrics during continuous operation.

### Hardware Components

| Component | GPIO Pin | Description |
|-----------|----------|-------------|
| DHT20 Sensor | SDA: 11, SCL: 12 | Temperature & Humidity sensor via I2C |
| ESP32-S3 MCU | - | Target device for TinyML model deployment |
| Flash Memory | - | Storage for TFLite model binary |
| RAM (SRAM) | - | Tensor arena for model inference (16 KB) |

### System Architecture

The TinyML system consists of three main components:

1. **Dataset & Model Training** ([ml/train_export.py](ml/train_export.py))
2. **TFLite Model Binary** ([ml/dht_risk_model.tflite](ml/dht_risk_model.tflite))
3. **On-Device Inference** ([src/tinyml.cpp](src/tinyml.cpp))

---

## 1. Dataset Description & Collection

### Dataset Overview

The training dataset is synthetically generated but realistic, based on a risk assessment function that combines temperature and humidity thresholds. The dataset is stored in [ml/dataset.csv](ml/dataset.csv) with approximately 5,000+ labeled samples.

### Dataset Structure

| Column | Type | Range | Description |
|--------|------|-------|-------------|
| temperature | float | 15.0 - 40.0 °C | Environmental temperature reading |
| humidity | float | 20.0 - 98.0 % | Environmental humidity reading |
| final_label | int | 1, 2, 3 | Risk level ground truth (1=Normal, 2=Warning, 3=Critical) |

**Sample Data (first 20 rows):**
```
temperature,humidity,final_label
15.1067,21.0640,1
15.2627,22.8465,1
14.3171,23.1829,1
...
15.2376,50.3189,2
15.1012,50.8262,2
14.4900,52.3252,2
```

### Data Collection Strategy

#### **Phase 1: Grid Sampling Near Decision Boundaries**

Critical regions around temperature and humidity thresholds are densely sampled:

```python
for t in np.linspace(15.0, 38.0, 28):          # 28 temperature points
    for h in np.linspace(22.0, 95.0, 32):      # 32 humidity points
        for _ in range(2):                      # 2 variations per point
            # Add Gaussian noise to create realistic variance
            tt = t + np.random.normal(0, 0.35)   # ±0.35°C std deviation
            hh = h + np.random.normal(0, 0.9)    # ±0.9% std deviation
            rows.append((tt, hh, final_label(tt, hh)))
```

This generates **1,792 samples** (~28 × 32 × 2) concentrated near decision boundaries for improved classification accuracy.

#### **Phase 2: Random Coverage**

Additional random samples fill the feature space uniformly:

```python
for _ in range(4000):  # Extra random samples
    tt = np.random.uniform(15.0, 40.0)
    hh = np.random.uniform(20.0, 98.0)
    rows.append((tt, hh, final_label(tt, hh)))
```

This adds **4,000 random samples** for broader coverage and generalization.

**Total Dataset Size: ~5,792 samples**

### Labeling Strategy: Rule-Based Ground Truth

Labels are determined by a rule-based risk assessment function that combines temperature and humidity thresholds:

**Temperature Bands (LED states):**
```c
if (temperature >= 30.0) return 3;  // Critical
if (temperature >= 25.0) return 2;  // Warning
return 1;                            // Normal
```

**Humidity Bands (NeoPixel states):**
```c
if (humidity >= 70.0) return 3;     // Critical
if (humidity >= 50.0) return 2;     // Warning
return 1;                            // Normal
```

**Final Risk Label (worst-case scenario):**
```c
int final_label(float t, float h) {
    int led = led_state_from_temperature(t);
    int neo = neo_state_from_humidity(h);
    return (led > neo) ? led : neo;  // Maximum of the two
}
```

This approach ensures:
- **Consistency**: Labels match firmware thresholds exactly
- **Physical Meaning**: Labels represent real risk levels (Normal/Warning/Critical)
- **Traceability**: Labels can be verified against hardware behavior

### Threshold Summary

| Feature | State | Condition | Risk Level |
|---------|-------|-----------|-----------|
| **Temperature** | 1 | T < 25°C | Normal |
| | 2 | 25°C ≤ T < 30°C | Warning |
| | 3 | T ≥ 30°C | Critical |
| **Humidity** | 1 | H < 50% | Normal |
| | 2 | 50% ≤ H < 70% | Warning |
| | 3 | H ≥ 70% | Critical |
| **Final Label** | 1,2,3 | max(temp_state, humidity_state) | Worst Case |

---

## 2. Model Architecture & Training

### Neural Network Design

A lightweight Keras Sequential model optimized for embedded deployment:

```python
model = tf.keras.Sequential([
    tf.keras.layers.Input(shape=(2,)),           # Input: [temperature, humidity]
    tf.keras.layers.Dense(24, activation="relu"), # Hidden layer 1: 24 neurons
    tf.keras.layers.Dense(16, activation="relu"), # Hidden layer 2: 16 neurons
    tf.keras.layers.Dense(3, activation="softmax") # Output: 3 classes (softmax)
])
```

**Model Specifications:**
- **Input Features**: 2 (temperature, humidity)
- **Output Classes**: 3 (Normal, Warning, Critical)
- **Total Parameters**: ~1,300 (fits easily in MCU SRAM)
- **Model Type**: Dense feed-forward network (fully connected)

### Training Configuration

**Optimizer & Loss:**
- **Optimizer**: Adam with learning rate 0.002
- **Loss Function**: Sparse Categorical Crossentropy
- **Metrics**: Accuracy

**Data Split:**
```python
n_samples = 5792
train_split = int(n_samples * 0.85)  # 4,923 training samples
val_split = n_samples - train_split    # 869 validation samples
```

**Training Hyperparameters:**
```python
epochs = 80
batch_size = 64
early_stopping = EarlyStopping(
    monitor='val_accuracy',
    mode='max',
    patience=15,  # Stop if no improvement for 15 epochs
    restore_best_weights=True
)
```

### Model Conversion to TFLite

The trained Keras model is converted to TensorFlow Lite float32 format:

```python
converter = tf.lite.TFLiteConverter.from_keras_model(model)
converter.optimizations = []  # No quantization (keep float32 precision)
tflite_model = converter.convert()
```

**Output Artifacts:**
- **TFLite Model**: [ml/dht_risk_model.tflite](ml/dht_risk_model.tflite) (~20-40 KB)
- **Header File**: [include/dht_anomaly_model.h](include/dht_anomaly_model.h) (hex-encoded binary)

---

## 3. On-Device Implementation & Inference

### TinyML Task Setup

The TinyML task is initialized in [src/main.cpp](src/main.cpp) and runs concurrently with other tasks:

```cpp
xTaskCreate(tiny_ml_task, "Tiny ML Task", 8192, (void *)ctx, 2, NULL);
```

### Model Initialization

The TFLite model is loaded and initialized in [src/tinyml.cpp](src/tinyml.cpp):

```cpp
void setupTinyML() {
    // Create error reporter for diagnostic messages
    static tflite::MicroErrorReporter micro_error_reporter;
    error_reporter = &micro_error_reporter;
    
    // Load model from flash memory
    model = tflite::GetModel(dht_anomaly_model_tflite);
    
    // Verify schema version compatibility
    if (model->version() != TFLITE_SCHEMA_VERSION) {
        error_reporter->Report("Model schema version mismatch");
        return;
    }
    
    // Create operation resolver (loads all supported ops)
    static tflite::AllOpsResolver resolver;
    
    // Allocate tensor arena (working memory for inference)
    static uint8_t tensor_arena[16 * 1024];  // 16 KB
    
    // Create interpreter
    static tflite::MicroInterpreter static_interpreter(
        model, resolver, tensor_arena, 16 * 1024, error_reporter
    );
    interpreter = &static_interpreter;
    
    // Allocate tensors
    if (interpreter->AllocateTensors() != kTfLiteOk) {
        error_reporter->Report("AllocateTensors() failed");
        return;
    }
    
    // Get input/output tensor pointers
    input = interpreter->input(0);   // Expects [temperature, humidity]
    output = interpreter->output(0); // Predicts [class0, class1, class2] scores
    
    s_tinyml_ready = true;
}
```

### Inference Loop

The main inference task runs every 5 seconds:

```cpp
void tiny_ml_task(void *pvParameters) {
    SharedContext *ctx = (SharedContext *)pvParameters;
    
    setupTinyML();
    
    unsigned long inferences = 0;
    unsigned long correct = 0;
    
    while (1) {
        // 1. Read sensor data from context (protected by mutex)
        xSemaphoreTake(ctx->mutexContext, pdMS_TO_TICKS(2000));
        float temperature = ctx->temperature;
        float humidity = ctx->humidity;
        xSemaphoreGive(ctx->mutexContext);
        
        // 2. Validate sensor readings
        if (isnan(temperature) || isnan(humidity) || 
            temperature < 0.0f || humidity < 0.0f) {
            Serial.println("TinyML: skip (invalid DHT reading)");
            vTaskDelay(pdMS_TO_TICKS(5000));
            continue;
        }
        
        // 3. Prepare input tensor
        input->data.f[0] = temperature;  // Feature 1: temperature
        input->data.f[1] = humidity;     // Feature 2: humidity
        
        // 4. Run inference and measure latency
        unsigned long t0 = millis();
        if (interpreter->Invoke() != kTfLiteOk) {
            error_reporter->Report("Invoke failed");
            vTaskDelay(pdMS_TO_TICKS(5000));
            continue;
        }
        unsigned long t1 = millis();
        
        // 5. Extract prediction (argmax of output softmax scores)
        int best = argmax_float(output->data.f, 3);
        int predicted = best + 1;  // Classes 0..2 → Labels 1..3
        
        // 6. Compare with rule-based ground truth
        int expected = risk_final_label(temperature, humidity);
        
        // 7. Update accuracy metrics
        if (predicted == expected) correct++;
        inferences++;
        
        // 8. Log inference results
        Serial.printf("TinyML T=%.1fC H=%.1f%% | rule=%d pred=%d | "
                      "p=[%.2f,%.2f,%.2f] | %lums | roll_acc=%.1f%% (%lu/%lu)\n",
                      temperature, humidity, expected, predicted,
                      output->data.f[0], output->data.f[1], output->data.f[2],
                      (t1 - t0),
                      100.0f * correct / inferences,
                      correct, inferences);
        
        vTaskDelay(pdMS_TO_TICKS(5000));
    }
}
```

### Key Implementation Features

**1. Thread-Safe Data Access:**
- Mutex protects `ctx->temperature` and `ctx->humidity` from concurrent access
- Timeout of 2 seconds prevents deadlock if other tasks stall

**2. Inference Validation:**
- Checks for NaN (Not-a-Number) sensor readings
- Skips inference if data is invalid
- Prevents erroneous predictions on bad data

**3. Latency Measurement:**
```cpp
unsigned long t0 = millis();
if (interpreter->Invoke() != kTfLiteOk) { /* handle error */ }
unsigned long t1 = millis();
unsigned long inference_time = t1 - t0;  // milliseconds
```

**4. Accuracy Tracking:**
```cpp
if (predicted == expected) correct++;
inferences++;
rolling_accuracy = (100.0f * correct) / inferences;
```

---

## 4. Accuracy Evaluation & Performance Metrics

### Real-Time Accuracy Monitoring

The system continuously logs predictions and compares them against rule-based ground truth:

**Output Format:**
```
TinyML T=25.3C H=55.2% | rule=2 pred=2 | p=[0.12,0.78,0.10] | 45ms | roll_acc=96.5% (115/119)
```

**Metric Interpretation:**
- `T=25.3C H=55.2%`: Current sensor readings
- `rule=2 pred=2`: Ground truth (2) vs prediction (2) - **CORRECT**
- `p=[0.12,0.78,0.10]`: Softmax probabilities for classes [1, 2, 3]
  - Class 1 (Normal): 12%
  - Class 2 (Warning): 78% (highest - predicted class)
  - Class 3 (Critical): 10%
- `45ms`: Time to run inference on ESP32-S3
- `roll_acc=96.5%`: Rolling accuracy (correct predictions / total predictions)
- `(115/119)`: 115 correct out of 119 total inferences

### Expected Performance

**On Validation Dataset (During Training):**
- Validation Accuracy: **95-99%** (depends on training run)
- Loss: **0.02-0.08**

**On Hardware (Real-Time):**
- Inference Latency: **30-50 ms** per prediction
- Memory Usage:
  - Model: ~20-40 KB
  - Tensor Arena: 16 KB
  - Stack: ~2 KB per inference
- CPU Load: ~5-10% (running every 5 seconds)

### Accuracy Factors

**Factors Supporting High Accuracy:**
1. **Simple Decision Boundary**: 3-class classification is easier than continuous regression
2. **Clean Training Data**: Synthetically generated with known rule-based labels
3. **Well-Separated Classes**: Temperature/humidity thresholds are distinct
4. **Adequate Training**: 5,792 samples >> model parameters (~1,300)

**Potential Sources of Error:**
1. **Sensor Noise**: DHT20 readings may have ±2-3% humidity error
2. **Boundary Cases**: Readings near threshold values (e.g., 24.9°C vs 25.1°C)
3. **Model Generalization**: Unseen sensor drift or environmental conditions

### Validation Strategy

**During Model Training:**
- 85/15 train/validation split
- Early stopping to prevent overfitting
- Validation accuracy monitored every epoch

**During Hardware Execution:**
- Every inference compared to rule-based ground truth
- Rolling accuracy computed (current / all-time)
- Inference time logged for performance analysis

### Expected Results Discussion

Given the task's design:

1. **Expected Accuracy: 95-98%** on real hardware
   - Same data distribution as training set
   - Simple classification task
   - Well-defined decision boundaries

2. **Why Not Perfect (100%)?**
   - Sensor noise in DHT20 readings
   - Model trained on clean synthetic data, hardware has real noise
   - Boundary region ambiguity (e.g., T=24.99°C is Normal vs T=25.01°C is Warning)

3. **Inference Speed: 30-50 ms**
   - Reasonable for 5-second polling interval
   - Does not block other tasks (asynchronous in FreeRTOS)
   - ESP32-S3 runs inference efficiently due to Xtensa dual-core architecture

---

## File Structure

```
ml/
├── dataset.csv                  # Training dataset (~5,792 samples)
├── dht_risk_model.tflite        # Compiled TFLite model binary
├── train_export.py              # Training script (Keras → TFLite)
└── requirements.txt             # Python dependencies

include/
├── tinyml.h                     # TinyML task declaration
├── dht_anomaly_model.h          # Hex-encoded TFLite model
└── risk_label.h                 # Rule-based label functions

src/
├── tinyml.cpp                   # TinyML inference implementation
├── temp_humi_monitor.cpp        # DHT20 sensor reading task
└── main.cpp                     # FreeRTOS task creation

lib/
├── TensorFlowLite_ESP32/        # TFLite Micro library
└── DHT20/                       # DHT20 sensor driver
```

---

## Running the System

### Prerequisites

```bash
pip install -r ml/requirements.txt  # tensorflow, numpy, etc.
```

### Training & Export

Generate dataset and train model:
```bash
python ml/train_export.py
```

Outputs:
- `ml/dataset.csv` - Training dataset
- `ml/dht_risk_model.tflite` - Model binary
- `include/dht_anomaly_model.h` - C++ header

### Deployment

1. Build and upload firmware to ESP32-S3
2. Open Serial Monitor at 115200 baud
3. Observe TinyML inference logs every 5 seconds

---

## References

- [TensorFlow Lite Micro Documentation](https://github.com/tensorflow/tflite-micro)
- [TensorFlow Lite Conversion Guide](https://www.tensorflow.org/lite/convert)
- [ESP32 TensorFlow Lite Support](https://github.com/espressif/tflite-micro-esp-examples)
- [FreeRTOS Documentation](https://www.freertos.org/)
- [DHT20 Sensor Datasheet](https://datasheet.lcsc.com/lcsc/2010011713150451_ASAIR-DHT20_C3294963.pdf)
- [ESP32-S3 Technical Reference](https://www.espressif.com/sites/default/files/documentation/esp32-s3_technical_reference_manual_en.pdf)


