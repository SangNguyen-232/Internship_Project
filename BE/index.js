const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());

// Serve static files cho admin dashboard
app.use('/admin', express.static(path.join(__dirname, 'admin_static'), { index: 'admin.html' }));

const pool = new Pool({
  host:     'localhost',
  database: 'iot_db',
  user:     'iot_user',
  password: 'iot_password',
  port:     5432,
});

// ───────────────────────────────────────────────
// API cũ (không thay đổi logic) - chỉ thêm device_id
// ───────────────────────────────────────────────
app.post('/sensor', async (req, res) => {
  try {
    const {
      timestamp_real,
      timestamp_up,
      temperature,
      humidity,
      soil_moisture,
      PUMP_state,
      MODE_state,
      Message,
      Score,
      device_id          // thêm mới - nếu ESP32 không gửi thì dùng default
    } = req.body;

    await pool.query(
      `INSERT INTO sensor_logs
        (timestamp_real, timestamp_up, temperature, humidity,
         soil_moisture, "PUMP_state", "MODE_state", "Message", "Score", device_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        timestamp_real === 'null' ? null : timestamp_real,
        timestamp_up,
        temperature,
        humidity,
        soil_moisture,
        PUMP_state,
        MODE_state,
        Message,
        Score,
        device_id || 'test'
      ]
    );

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ───────────────────────────────────────────────
// API MỚI cho Admin Dashboard
// ───────────────────────────────────────────────

// GET /admin/api/devices
// Trả về danh sách tất cả thiết bị với dữ liệu mới nhất
app.get('/admin/api/devices', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (device_id)
        device_id,
        temperature,
        humidity,
        soil_moisture,
        "PUMP_state",
        "MODE_state",
        "Message",
        "Score",
        timestamp_real,
        timestamp_up
      FROM sensor_logs
      ORDER BY device_id, timestamp_up DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/api/devices/:device_id/history?limit=60
// Trả về lịch sử readings của 1 thiết bị (dùng cho chart trong detail view)
app.get('/admin/api/devices/:device_id/history', async (req, res) => {
  try {
    const { device_id } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 60, 200);

    const result = await pool.query(`
      SELECT
        temperature,
        humidity,
        soil_moisture,
        "PUMP_state",
        "MODE_state",
        "Message",
        "Score",
        timestamp_real,
        timestamp_up
      FROM sensor_logs
      WHERE device_id = $1
      ORDER BY timestamp_up DESC
      LIMIT $2
    `, [device_id, limit]);

    res.json(result.rows.reverse()); // trả về theo thứ tự thời gian tăng dần
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('API running on port 3000'));