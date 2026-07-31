# ESP32-S3 IoT Environmental Monitoring System

A real-time IoT environmental monitoring system running on the **ESP32-S3 (Yolo Uno)** microcontroller. The system integrates multi-sensor data acquisition, multi-channel hardware alerting, automated pump control, on-device TinyML inference, an embedded Web server, and a Node.js/PostgreSQL backend with a multi-device Admin Dashboard.

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Hardware](#hardware)
- [Directory Structure](#directory-structure)
- [ESP32-S3 Firmware](#esp32-s3-firmware)
  - [FreeRTOS Tasks](#freertos-tasks)
  - [SharedContext](#sharedcontext)
  - [Risk Classification Logic](#risk-classification-logic)
  - [TinyML](#tinyml)
  - [Wi-Fi and Embedded Web Server](#wi-fi-and-embedded-web-server)
  - [Pump Control](#pump-control)
  - [LittleFS](#littlefs)
  - [Factory Reset](#factory-reset)
- [Node.js Backend](#nodejs-backend)
  - [API Endpoints](#api-endpoints)
  - [PostgreSQL Database](#postgresql-database)
  - [Authentication and Authorization](#authentication-and-authorization)
- [Frontend](#frontend)
  - [Device Dashboard (embedded on ESP32)](#device-dashboard-embedded-on-esp32)
  - [Admin Dashboard (Node.js)](#admin-dashboard-nodejs)
- [ML Pipeline](#ml-pipeline)
- [Utility Scripts](#utility-scripts)
- [Installation and Deployment](#installation-and-deployment)
- [Security Notes](#security-notes)
- [Libraries Used](#libraries-used)

---

## Overview

The project monitors three environmental parameters — **temperature**, **air humidity**, and **soil moisture** — on a 5-second cycle. Each measurement cycle:

1. Data is displayed in real time on a **16×2 LCD**.
2. A **single LED (GPIO48)** blinks at a frequency reflecting the temperature risk level.
3. A **NeoPixel WS2812B LED (GPIO45)** changes color to reflect the air humidity risk level.
4. A **pump (GPIO6)** is automatically toggled based on soil moisture thresholds, or controlled manually from the Dashboard.
5. A **TinyML model (TensorFlow Lite Micro)** classifies the combined risk level directly on-chip.
6. Data is pushed via **WebSocket** to the embedded Dashboard and sent via **HTTP POST** to the Node.js/PostgreSQL backend.

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                  ESP32-S3 (Yolo Uno)                │
│                                                     │
│  ┌──────────────┐    ┌────────────────────────────┐ │
│  │  FreeRTOS    │    │       SharedContext         │ │
│  │  Tasks       │◄──►│  temperature / humidity    │ │
│  │              │    │  soilMoisture / ledState   │ │
│  │ temp_humi    │    │  neoState / lcdState       │ │
│  │ led_blinky   │    │  mlStatus / mlRollAcc      │ │
│  │ neo_blinky   │    │  timestampReal / Us        │ │
│  │ task_pump    │    │  dbTriggerSource           │ │
│  │ tiny_ml_task │    │  mutexContext              │ │
│  │ task_database│    │  sem{LED/Neo/LCD/DB}Update │ │
│  │ Task_BOOT    │    └────────────────────────────┘ │
│  └──────────────┘                                   │
│                                                     │
│  LittleFS: /info.dat, /wifi_list.json, web assets   │
│  ESPAsyncWebServer (port 80) + WebSocket (/ws)      │
│  ElegantOTA (/update)                               │
└────────────────┬────────────────────────────────────┘
                 │ HTTP POST /sensor  (port 3000)
                 │ WebSocket ws://device_ip/ws
                 ▼
┌─────────────────────────────────────────────────────┐
│              Backend Node.js (port 3000)            │
│  Express.js + express-session (8h)                  │
│  PostgreSQL: iot_db                                 │
│   ├── sensor_logs (13 columns)                      │
│   ├── system_users (admin / user)                   │
│   └── device_credentials                            │
│  Admin Dashboard (/admin) — multi-device monitoring │
└─────────────────────────────────────────────────────┘
```

---

## Hardware

| Component | GPIO / Interface | Role |
|---|---|---|
| ESP32-S3 (Yolo Uno) | — | Central microcontroller running FreeRTOS + TinyML |
| DHT20 sensor | I2C: SDA=GPIO11, SCL=GPIO12 | Measures temperature and air humidity |
| Soil moisture sensor | ADC: GPIO2 (`SOIL_PIN = 2`) | Measures soil moisture; raw ADC [0–4095] → [0–100]% |
| 16×2 LCD | I2C: address 0x27 | Displays T / H / SM / system status |
| Onboard single LED | GPIO48 (`LED_GPIO = 48`) | Blinks at rate reflecting temperature risk |
| NeoPixel WS2812B (1 LED) | GPIO45 (`NEO_PIN = 45`), NEO_GRB+NEO_KHZ800 | Changes color reflecting air humidity risk |
| Mini pump (via relay) | GPIO6 (`PUMP_PIN = 6`) | Controls automatic/manual irrigation |
| Onboard BOOT button | GPIO0 (`INPUT_PULLUP`) | Hold > 2 seconds to factory-reset all settings |

> **Note:** The soil moisture sensor is connected to **GPIO2** (`SOIL_PIN = 2` as defined in `temp_humi_monitor.cpp`).

---

## Directory Structure

```
Internship_Project/
├── src/                         # C++ firmware for ESP32
│   ├── main.cpp                 # setup() / loop(), FreeRTOS task creation
│   ├── global.cpp               # Global variable definitions
│   ├── temp_humi_monitor.cpp    # Reads DHT20 + soil sensor, LCD, WebSocket push
│   ├── led_blinky.cpp           # Single LED control task
│   ├── neo_blinky.cpp           # NeoPixel control task
│   ├── pump.cpp                 # Pump AUTO/MANUAL control task
│   ├── tinyml.cpp               # TensorFlow Lite Micro inference task
│   ├── task_database.cpp        # HTTP POST to backend task
│   ├── task_webserver.cpp       # ESPAsyncWebServer, WebSocket, embedded REST API
│   ├── task_wifi.cpp            # AP Mode / STA Mode / NTP / network switching
│   ├── task_check_info.cpp      # /info.dat and /wifi_list.json management (LittleFS)
│   ├── task_handler.cpp         # Handles incoming WebSocket messages from clients
│   ├── task_toogle_boot.cpp     # Factory reset via BOOT button (GPIO0)
│   └── serial_log.cpp           # Mutex-protected Serial output
├── include/
│   ├── global.h                 # SharedContext struct, extern variable declarations
│   ├── risk_label.h             # Risk classification functions and safety interlock
│   ├── dht_anomaly_model.h      # TFLite model embedded as a C byte array
│   ├── project_includes.h       # Common include aggregator
│   └── *.h                      # Header files for each module
├── data/
│   └── wifi_info.json           # Wi-Fi credential list (uploaded to LittleFS)
├── ml/
│   ├── train_export.py          # Training and TFLite export script
│   ├── dataset.csv              # Synthesized training dataset
│   ├── dht_risk_model.tflite    # Trained TFLite model
│   └── requirements.txt         # tensorflow, numpy
├── BE/                          # Node.js backend
│   ├── index.js                 # Express server, REST API, session management
│   ├── admin_static/            # Admin Dashboard (HTML/CSS/JS)
│   └── login_static/            # Login page static files
├── FE/                          # Device Dashboard (uploaded to LittleFS)
│   ├── dashboard.html
│   ├── dashboard.css
│   └── dashboard.js
├── DB/
│   ├── DB.sql                   # Creates database, sensor_logs, device_credentials tables
│   └── auth_migration.sql       # Creates system_users table and default accounts
├── scripts/
│   ├── pull_wifi_info.py        # Reads /wifi_list.json from ESP32 Flash to the host PC
│   ├── split_libs.ps1           # Library splitting build utility
│   └── README_split_libs.md     # Documentation for the split_libs script
├── boards/
│   └── yolo_uno.json            # Board definition for PlatformIO
└── platformio.ini               # PlatformIO build configuration
```

---

## ESP32-S3 Firmware

All firmware is developed using the **Arduino Framework on PlatformIO**, running on the **FreeRTOS** RTOS built into the ESP32-S3.

**AP Mode credentials** (defined in `platformio.ini`):
- SSID: `ESP32 LOCAL`
- Password: `12345678`

### FreeRTOS Tasks

`setup()` initializes `SharedContext` and then creates 7 tasks, all at priority level 2:

| Task | Stack | Function |
|---|---|---|
| `temp_humi_monitor` | 2048 words | Reads DHT20 + soil sensor every 5 seconds, updates SharedContext, controls LCD, pushes WebSocket data |
| `led_blinky` | 2048 words | Blinks LED GPIO48 according to `ledState` (1000/500/100 ms) |
| `neo_blinky` | 2048 words | Changes NeoPixel GPIO45 color based on `neoState` |
| `task_pump` | 2048 words | Controls pump GPIO6 every 100 ms in AUTO or MANUAL mode |
| `tiny_ml_task` | 8192 words | Runs TFLite Micro inference every 5 seconds, tracks `mlRollAcc` |
| `task_database` | 4096 words | Sends HTTP POST to `/sensor` on the backend with 200 ms debounce |
| `Task_Toogle_BOOT` | 4096 words | Monitors BOOT button GPIO0; triggers factory reset if held > 2 seconds |

**`loop()` responsibilities:**
- Detects the `g_wifiSwitchFlag` flag to switch Wi-Fi networks without rebooting.
- Calls `check_info_File(1)` to attempt STA reconnection if SSID is configured; calls `Webserver_stop()` if reconnection fails.
- Calls `Webserver_reconnect()` to restart the web server if it has stopped.
- Calls `ElegantOTA.loop()` continuously for OTA update handling.

**Synchronization mechanisms:**

- `mutexContext` — protects all sensor data and state fields within `SharedContext`.
- `xMutexPumpControl` — protects pump-control variables (`global_pump_state`, `pump_manual_control`, `pump_manual_state`) independently.
- `semLEDUpdate` — signaled by `temp_humi_monitor` when `ledState` changes → `led_blinky` updates its blink period immediately.
- `semNeoUpdate` — same pattern for NeoPixel.
- `semLCDUpdate` — same pattern for LCD status display.
- `semDBUpdate` — signaled after each sensor read cycle or when pump state changes → `task_database` sends an HTTP POST.
- `serialLogLock / serialLogUnlock` — dedicated mutex preventing interleaved Serial output from concurrent tasks.

---

### SharedContext

The central data structure shared among all tasks (defined in `include/global.h`):

```cpp
struct SharedContext {
    float temperature;          // °C, -1 if NaN
    float humidity;             // %, -1 if NaN
    int   soilMoisture;         // % [0–100], mapped from ADC [0–4095]
    int   soilRaw;              // Raw ADC value
    int   ledState;             // 1=Normal / 2=Warning / 3=Critical (temperature)
    int   neoState;             // 1=Normal / 2=Warning / 3=Critical (air humidity)
    int   lcdState;             // 1/2/3, computed by risk_final_safety_label()
    int   mlPredicted;          // TinyML predicted label (1/2/3)
    float mlConfidence;         // Highest Softmax probability
    char  mlStatus[16];         // "Normal"/"Warning"/"Critical"/"Mismatch"
    float mlRollAcc;            // Rolling accuracy (%), accumulated over session
    time_t      timestampReal;  // Seconds since epoch (NTP), 0 if not synced
    suseconds_t timestampRealUs;// Additional microseconds component
    char  dbTriggerSource[8];   // "sensor" or "pump"
    // FreeRTOS handles
    SemaphoreHandle_t mutexContext;
    SemaphoreHandle_t semLEDUpdate;
    SemaphoreHandle_t semNeoUpdate;
    SemaphoreHandle_t semLCDUpdate;
    SemaphoreHandle_t semDBUpdate;
};
```

---

### Risk Classification Logic

All thresholds are defined in `include/risk_label.h`.

**Single LED — by temperature (`risk_led_state_from_temperature`):**

| State | Temperature | Blink Period |
|---|---|---|
| Normal | 15 °C – 25 °C | 1000 ms |
| Warning | 10–15 °C or 25–30 °C | 500 ms |
| Critical | < 10 °C or > 30 °C | 100 ms |

**NeoPixel — by air humidity (`risk_neo_state_from_humidity`):**

| State | Air Humidity | Color |
|---|---|---|
| Normal | 60% – 70% | Green `(0, 255, 0)` |
| Warning | 50–60% or 70–80% | Yellow `(255, 255, 0)` |
| Critical | < 50% or > 80% | Red `(255, 0, 0)` |

**Soil moisture risk state (`risk_soil_state_from_moisture`):**

| State | Soil Moisture |
|---|---|
| Normal | 25% – 45% |
| Warning | 25–30% or 40–45% |
| Critical | < 25% or > 45% |

**LCD and DB — composite label (`risk_final_safety_label`):**

Step 1 — **Hard Safety Interlock**: if `T ≥ 40°C` OR `H ≥ 90%` OR `soil < 15%` OR `soil > 60%` → returns Critical immediately, skipping step 2.

Step 2 — **Piecewise linear penalty algorithm** (`risk_pure_mathematical_label`):

```
r = 0.35 × penalty(T) + 0.20 × penalty(H) + 0.45 × penalty(soil)

r ≤ 3.0  → Normal
r ≤ 6.5  → Warning
r > 6.5  → Critical
```

Optimal zones (penalty = 0): T∈[15,25]°C, H∈[60,70]%, soil∈[30,40]%.

---

### TinyML

A 3-class classifier (Normal/Warning/Critical) running on the ESP32-S3 via **TensorFlow Lite Micro**.

**Network architecture:** `Input(3) → Dense(32, ReLU) → Dense(16, ReLU) → Dense(3, Softmax)`

**Tensor arena:** 16 KiB (`kTensorArenaSize = 16 * 1024`), statically allocated.

**Data type:** float32 — no quantization (`converter.optimizations = []`).

**Input:** `[temperature, humidity, soil_moisture]` as float32.

**Output:** probability vector `[p0, p1, p2]` — `predicted = argmax + 1` (maps index 0..2 to label 1..3).

**On-device evaluation:**
- `expected` = `risk_pure_mathematical_label(T, H, S)` — does **not** apply the safety interlock.
- `mlRollAcc = correct / inferences × 100%` — accumulated across the entire runtime session.
- `mlStatus` applies the safety interlock separately: if an extreme condition is detected → forces `"Critical"` regardless of predicted/expected; if `predicted ≠ expected` → sets `"Mismatch"`.

**Serial log each cycle (115200 baud):**
```
TinyML T=XX.X°C H=XX.X% S=XX% | rule=N pred=N | <status> | p=[p0,p1,p2] | Xms | roll_acc=XX.X% (correct/total)
```

**Inference time** is measured with `millis()` before and after `Invoke()`.

**Retraining:** run `ml/train_export.py` → outputs `ml/dht_risk_model.tflite` → automatically converts to `include/dht_anomaly_model.h` for embedding into firmware.

---

### Wi-Fi and Embedded Web Server

**Boot sequence:**

```
setup()
  └── check_info_File(false)
        ├── LittleFS.begin(true)
        ├── Load /info.dat (WIFI_SSID, WIFI_PASS, STA_IP)
        ├── WIFI_SSID empty → startAP()   [AP Mode: "ESP32 LOCAL" / "12345678"]
        └── WIFI_SSID set → loop() → Wifi_reconnect() → startSTA()
                └── On successful connection:
                      ├── Save_sta_ip_File() → updates STA_IP in /info.dat
                      ├── configTime(7*3600, 0, "pool.ntp.org", "time.nist.gov")
                      └── xSemaphoreGive(xBinarySemaphoreInternet)
```

STA Mode connection timeout: 10 seconds (`millis() - start < 10000`).

**Network switching without reboot** (`POST /api/wifi-switch`):
1. Sets `g_wifiSwitchSSID` and `g_wifiSwitchPass`, sets the flag `g_wifiSwitchFlag = true`.
2. `loop()` detects the flag → calls `Wifi_switch_to()`.
3. `Wifi_switch_to()` calls `Save_wifi_to_list()` + `Save_info_NoRestart()` to persist the new network, then `WiFi.disconnect(true)` → delay 500 ms → `startSTA()` (no `ESP.restart()`).

**Wi-Fi list `/wifi_list.json`:** newest SSID is prepended to the front; if an SSID already exists, only its password is updated, keeping its current position.

**Embedded REST API (port 80):**

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Serves `dashboard.html` from LittleFS |
| `/ws` | WebSocket | Pushes sensor data every 5 seconds; receives control commands |
| `/api/status` | GET | Returns `{mqtt_connected, is_ap_mode}` |
| `/toggle-pump?state=ON\|OFF` | GET | Toggles pump manually (toggles if no parameter provided) |
| `/set-mode?mode=AUTO\|MANUAL` | GET | Switches pump operating mode |
| `/api/wifi-list` | GET | Returns saved Wi-Fi network list from `/wifi_list.json` |
| `/api/wifi-switch` | POST | Switches to a new Wi-Fi network without reboot (`{ssid, pass}`) |
| `/update` | GET/POST | ElegantOTA — browser-based OTA firmware update |

**WebSocket payload from device** (every 5 seconds):
```json
{"temperature": 25.30, "humidity": 65.20, "soil_moisture": 35, "lcd_state": 1}
```

**WebSocket pump control payload:**
```json
{"pump_state": "ON", "pump_mode": "MANUAL"}
```

When a client first connects, the server immediately sends the current pump state to synchronize the UI.

---

### Pump Control

The `task_pump` task runs every 100 ms (`vTaskDelay(100 / portTICK_PERIOD_MS)`):

**AUTO mode** (`pump_manual_control = false`):
- Pump turns ON when `soilMoisture < PUMP_SOIL_THRESHOLD` (= **5%**).
- Pump turns OFF when `soilMoisture ≥ 5%`.

**MANUAL mode** (`pump_manual_control = true`):
- Pump state follows `pump_manual_state`, set by the `/toggle-pump` endpoint.

When the pump state changes (`new_state ≠ last_reported_state`):
1. Updates `global_pump_state` under `xMutexPumpControl`.
2. Pushes a WebSocket message to all connected clients.
3. Sets `dbTriggerSource = "pump"` and signals `semDBUpdate` to log the event to PostgreSQL.

---

### LittleFS

Internal flash filesystem on the ESP32-S3, mounted at boot with `LittleFS.begin(true)`.

| File | Content |
|---|---|
| `/info.dat` | JSON: `{"WIFI_SSID": "...", "WIFI_PASS": "...", "STA_IP": "..."}` |
| `/wifi_list.json` | JSON array: `[{"ssid": "...", "pass": "..."}, ...]` — newest entry first |
| `/dashboard.html` | Device Dashboard HTML |
| `/dashboard.css` | Device Dashboard stylesheet |
| `/dashboard.js` | Device Dashboard logic (WebSocket, Chart.js, Leaflet) |

> **Note:** The `data/` directory in the repository contains `wifi_info.json`, which is uploaded to the LittleFS filesystem as `/wifi_list.json` via `pio run --target uploadfs` (the `data_dir = FE` setting in `platformio.ini` means the `FE/` directory is uploaded as the filesystem root, so adjust accordingly when pre-loading Wi-Fi credentials).

---

### Factory Reset

Hold the **BOOT button (GPIO0)** continuously for more than **2 seconds**:
- Deletes `/info.dat` from LittleFS.
- Overwrites `/wifi_info.json` with `{}` (empty JSON object).
- Calls `ESP.restart()` → device reboots in AP Mode.

---

## Node.js Backend

Located in the `BE/` directory, runs on **port 3000**.

```bash
cd BE
npm install
node index.js
```

### API Endpoints

**Device data:**

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/sensor` | POST | — | ESP32 sends sensor data; INSERTs a row into `sensor_logs` |
| `/admin/api/devices` | GET | Login | List of devices (most recent record per device) |
| `/admin/api/devices/:id/history?limit=60` | GET | Login | History up to 200 records for a specific device |
| `/admin/api/devices/:id` | DELETE | Admin | Deletes all data for a specific device |

**Device credentials:**

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/admin/api/devices/:id/verify` | POST | Login | Verifies a device password (`{password}`) |
| `/admin/api/devices/:id/password` | POST | Admin | Sets or updates a device password (`{password}`) |

**System accounts:**

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/login` | GET/POST | — | Login page / login handler |
| `/register` | POST | — | Registers a new account (role = `user`) |
| `/logout` | POST | — | Destroys the session |
| `/api/me` | GET | — | Returns `{loggedIn, username, role}` |
| `/admin/api/users` | GET | Admin | Lists all system accounts |
| `/admin/api/users` | POST | Admin | Creates a new account (`{username, password, role}`) |
| `/admin/api/users/:id` | DELETE | Admin | Deletes an account (cannot delete the currently logged-in account) |

---

### PostgreSQL Database

**Database:** `iot_db` — **User:** `iot_user` / `004232`

**`sensor_logs` table (13 columns):**

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER (identity) | Auto-increment primary key |
| `timestamp_real` | timestamp | Sensor measurement time (from NTP), NULL if not synced |
| `timestamp_up` | timestamp NOT NULL | Time when the backend received the POST request |
| `temperature` | text | Example: `"25.30°C"` |
| `humidity` | text | Example: `"65.20%"` |
| `soil_moisture` | text | Example: `"35%"` |
| `PUMP_state` | text | `"ON"` or `"OFF"` |
| `MODE_state` | text | `"AUTO"` or `"MANUAL"` |
| `Message` | text | `"Normal"` / `"Warning"` / `"Critical"` |
| `Score` | text | `mlRollAcc` formatted as a percentage, e.g., `"97.50%"` |
| `device_id` | text | LAN IP address of the ESP32 device |
| `latency` | int | End-to-end latency in microseconds: `t_up − t_real` |
| `trigger_source` | text | `"sensor"` or `"pump"` |

**`device_credentials` table:** `device_id (PK)`, `password` — per-device access password.

**`system_users` table:** `id`, `username (UNIQUE)`, `password`, `role CHECK('admin','user')`, `created_at`.

**Database initialization:**
```bash
psql -U postgres -f DB/DB.sql
psql -U postgres -d iot_db -f DB/auth_migration.sql
```

**DB write debounce (in `task_database.cpp`):**
- Minimum interval between two consecutive POSTs from the same trigger source: **200 ms**.
- A `"sensor"` event is skipped if `g_pumpEventPending = true` or if the most recent pump POST was less than 200 ms ago — pump events are always prioritized.

**Latency** = `gettimeofday()` at the `task_database` send time − `gettimeofday()` at sensor read time, in **microseconds (µs)**.

> **Note:** The backend resolves the target URL dynamically using `global_admin_ip`, which is captured from the IP of the first WebSocket or HTTP client that connects to the device's embedded web server. The ESP32 does **not** use a hardcoded backend IP.

---

### Authentication and Authorization

- **Session:** `express-session`, lifetime **8 hours**, `httpOnly` cookie.
- **Default accounts** (created by `auth_migration.sql`):
  - `admin` / `123456` — role `admin`
  - `user1` / `123456` — role `user`
- **Passwords are currently stored in plain-text** — replace with `bcrypt` before production deployment.

**Authorization matrix:**

| Feature | Admin | User |
|---|---|---|
| View device list | ✅ | ✅ |
| View device history | ✅ | ✅ |
| Access Device Dashboard (directly) | ✅ no password required | ✅ requires device password |
| Delete devices | ✅ | ❌ |
| Set device password | ✅ | ❌ |
| Manage system accounts | ✅ | ❌ |
| Bulk select and delete devices | ✅ | ❌ |

**Session timeout on Device Dashboard:** User is redirected back after **5 minutes** (tracked via the `?session_start=HH:MM:SS` URL parameter).

---

## Frontend

### Device Dashboard (embedded on ESP32)

Served from LittleFS at `http://<device_ip>/`. Source files are in `FE/`.

**Features:**
- Displays temperature, air humidity, and soil moisture in real time via WebSocket.
- Sensor value colors map to risk thresholds defined in `risk_label.h`: Normal (green), Warning (orange), Critical (red).
- Edge case: displays `"100%"` when `humidity ≥ 99.95`.
- Historical line chart (Chart.js, up to 60 data points, 5/15-second intervals).
- Location map (Leaflet + OpenStreetMap).
- Pump status badge (ON/OFF) and mode badge (AUTO/MANUAL) with a Toggle button.
- Composite environmental status notification (from `lcd_state`).
- Wi-Fi configuration modal (sends via WebSocket or `/api/wifi-switch`).
- Shows an "The device is in AP Mode" overlay when `/api/status` reports `is_ap_mode: true`.
- WebSocket **auto-reconnects after 2 seconds** when the connection drops.
- Fallback pure-canvas chart when Chart.js fails to load (offline mode).

### Admin Dashboard (Node.js)

Served at `http://<server>:3000/admin` (redirects to `admin.html`). Source files are in `BE/admin_static/`.

**Features:**
- Displays a card grid, one card per device, refreshed every **5 seconds** (`/admin/api/devices`).
- Each card establishes a **direct WebSocket connection** to `ws://<device_id>/ws` for real-time data.
- **Online/Offline status:**
  - After `STALE_DIFF_MS = 10,000 ms` with no new data → begins a countdown.
  - `COUNTDOWN_SECONDS = 5` → transitions to Offline.
  - Offline state displays time elapsed in 30-second multiples.
- Sensor value colors correctly map to `risk_label.h` thresholds.
- **Admin:** card checkboxes, action bar, bulk device deletion.
- **User:** all delete/select features are hidden; must enter the device password before accessing a Device Dashboard.
- Live clock, and overall statistics (total / online / offline count).

---

## ML Pipeline

The script `ml/train_export.py` executes the full pipeline:

```bash
pip install -r ml/requirements.txt
python ml/train_export.py
```

**Steps:**

1. **Data generation** (`build_dataset`):
   - Grid scan with `np.linspace`: T∈[5,50]°C × H∈[20,100]% × S∈[0,100]% (20×20×20×2 samples) + Gaussian noise.
   - 5000 additional uniformly distributed random samples.
   - Labels automatically assigned by `final_label()` — synchronized with `risk_label.h`.
   - Saved to `ml/dataset.csv`.

2. **Training:**
   - Split: 85% train / 15% validation.
   - Optimizer: Adam (lr=0.002), batch size=64, max epochs=80.
   - EarlyStopping: monitors `val_accuracy`, patience=15, restores best weights.

3. **Model export:**
   - TFLite float32, no quantization (`converter.optimizations = []`) → `ml/dht_risk_model.tflite`.
   - Converts to a C byte array → `include/dht_anomaly_model.h` for embedding in firmware.

**Outputs:**
- `ml/dataset.csv` — training dataset.
- `ml/dht_risk_model.tflite` — trained TFLite model.
- `include/dht_anomaly_model.h` — model pre-embedded in firmware.

---

## Utility Scripts

### `scripts/pull_wifi_info.py`

Reads the content of `/wifi_list.json` from the ESP32 Flash and saves it to the host PC as `data/wifi_info.json`.

**Installation:**
```bash
pip install esptool littlefs-python
```

**First use** (find LittleFS offset and size):
```bash
# Find default_8MB.csv in PlatformIO (PowerShell):
Get-ChildItem -Path "$env:USERPROFILE\.platformio" -Recurse -Filter "default_8MB.csv" | Select-Object FullName

# Run with partition-specific offset/size:
python scripts/pull_wifi_info.py --port COM7 --offset 0x670000 --size 0x180000
```

**Normal use** (after configuration is known):
```bash
python scripts/pull_wifi_info.py --port COM7
```

### `scripts/split_libs.ps1`

A PowerShell utility for splitting large library archives during the PlatformIO build process. See `scripts/README_split_libs.md` for details.

---

## Installation and Deployment

### 1. ESP32-S3 Firmware

**Requirements:** PlatformIO IDE or CLI.

```bash
# Build and flash firmware
pio run --target upload

# Upload filesystem (Dashboard files to LittleFS)
pio run --target uploadfs

# Open Serial Monitor (115200 baud)
pio device monitor
```

> **Note:** The `data_dir` in `platformio.ini` is set to `FE/`. This means the contents of `FE/` (`dashboard.html`, `dashboard.css`, `dashboard.js`) are uploaded to LittleFS. Edit `data/wifi_info.json` with your Wi-Fi credentials and manually upload it or pre-load it separately if needed.

### 2. Retrain the Model (optional)

```bash
pip install -r ml/requirements.txt
python ml/train_export.py
# Then rebuild and re-flash firmware to embed the new model
pio run --target upload
```

### 3. Node.js Backend

**Requirements:** Node.js ≥ 16, PostgreSQL running.

```bash
# Initialize the database
psql -U postgres -f DB/DB.sql
psql -U postgres -d iot_db -f DB/auth_migration.sql

# Install dependencies and start
cd BE
npm install
node index.js
# Server runs at http://localhost:3000
```

### 4. Access Points

| Address | Description |
|---|---|
| `http://<device_ip>/` | Device Dashboard (served from ESP32) |
| `http://<device_ip>/update` | ElegantOTA — browser-based firmware update |
| `http://<server>:3000/login` | Admin login page |
| `http://<server>:3000/admin` | Admin Dashboard |

### 5. First-time Wi-Fi Configuration for the Device

1. Power on the ESP32 with no `/info.dat` present → device broadcasts in AP Mode (`ESP32 LOCAL`).
2. Connect a PC or smartphone to the device's Wi-Fi AP (password: `12345678`).
3. Open a browser → navigate to the Dashboard → go to Settings → enter SSID/Password → Save & Connect.
4. The device saves the credentials and restarts in STA Mode.

---

## Security Notes

> ⚠️ **System account passwords** are currently stored **plain-text** in PostgreSQL. Replace with `bcrypt` before production deployment (noted in `auth_migration.sql`).

> ⚠️ **Default accounts** `admin/123456` and `user1/123456` — change immediately after deployment.

> ⚠️ **Session secret** `'iot-secret-change-in-production'` in `index.js` — must be replaced with a long random string before production.

> ⚠️ **Database password** `004232` for `iot_user` is hardcoded in `index.js` — move to environment variables before production.

> ℹ️ **Latency** stored in the `latency` column of `sensor_logs` is in **microseconds (µs)**, not milliseconds.

> ℹ️ **Backend URL discovery:** The ESP32 does not use a hardcoded backend IP. It captures the IP of the first browser/client that connects to its embedded web server (via HTTP or WebSocket) and uses that IP as the backend target for HTTP POST requests. The backend must therefore be accessible from the same network as the connecting browser.

---

## Libraries Used

**Firmware (PlatformIO — `platformio.ini`):**
- `ESPAsyncWebServer` (from GitHub: `me-no-dev/ESPAsyncWebServer`) — asynchronous web server
- `TensorFlowLite_ESP32` (`tanakamasayuki/TensorFlowLite_ESP32@1.0.0`) — TensorFlow Lite Micro
- `Adafruit NeoPixel` (`adafruit/Adafruit NeoPixel@^1.15.1`) — WS2812B LED control
- `DHT20` — temperature/humidity sensor driver
- `LiquidCrystal_I2C` — I2C LCD display driver
- `ArduinoJson` — JSON read/write (LittleFS, WebSocket)
- `ElegantOTA` — browser-based OTA firmware update

**Backend (`BE/package.json`):**
- `express@^5.2.1` — REST framework
- `express-session@^1.19.0` — session management
- `pg@^8.22.0` — PostgreSQL client

**Frontend (CDN):**
- `Chart.js` — sensor history line chart
- `Leaflet` + OpenStreetMap — location map
