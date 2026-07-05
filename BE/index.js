const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  host:     'localhost',
  database: 'iot_db',
  user:     'iot_user',
  password: 'iot_password',
  port:     5432,
});

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
      Score
    } = req.body;

    await pool.query(
      `INSERT INTO sensor_logs
        (timestamp_real, timestamp_up, temperature, humidity,
         soil_moisture, "PUMP_state", "MODE_state", "Message", "Score")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        timestamp_real === 'null' ? null : timestamp_real,
        timestamp_up,
        temperature,
        humidity,
        soil_moisture,
        PUMP_state,
        MODE_state,
        Message,
        Score
      ]
    );

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.listen(3000, () => console.log('API running on port 3000'));