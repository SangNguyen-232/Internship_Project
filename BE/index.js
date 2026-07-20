const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ─── Session ───────────────────────────────────────────────
app.use(session({
  secret: 'iot-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000   // 8 giờ
  }
}));

// ─── Database ──────────────────────────────────────────────
const pool = new Pool({
  host:     'localhost',
  database: 'iot_db',
  user:     'iot_user',
  password: '004232',
  port:     5432,
});

// ─── Auth Middlewares ───────────────────────────────────────

function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).json({ error: 'Chỉ Admin mới có quyền thực hiện thao tác này.' });
}

// ─── Static: Login page (không cần auth) ───────────────────
app.use('/login-static', express.static(path.join(__dirname, 'login_static')));

// ─── Login page ─────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/admin/admin.html');
  res.sendFile(path.join(__dirname, 'login_static', 'login.html'));
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin.' });
    }

    const result = await pool.query(
      'SELECT id, username, role FROM system_users WHERE username = $1 AND password = $2',
      [username.trim(), password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }

    const user = result.rows[0];
    req.session.user = { id: user.id, username: user.username, role: user.role };

    res.json({ ok: true, role: user.role, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Tài khoản hoặc mật khẩu không đúng.' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// API: trả về thông tin user đang đăng nhập (dùng cho frontend kiểm tra session)
app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ loggedIn: true, username: req.session.user.username, role: req.session.user.role });
  } else {
    res.json({ loggedIn: false });
  }
});

// ─── Root redirect ──────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/admin/admin.html');
  res.redirect('/login');
});

// ─── Static: Admin dashboard (yêu cầu đăng nhập) ──────────
app.use('/admin', requireLogin, express.static(path.join(__dirname, 'admin_static'), { index: 'admin.html' }));

// ─── ESP32 → POST sensor data (không cần auth, ESP32 gọi trực tiếp) ───
app.post('/sensor', async (req, res) => {
  try {
    const {
      timestamp_real, timestamp_up, temperature, humidity,
      soil_moisture, PUMP_state, MODE_state, Message, Score,
      device_id, latency, trigger_source
    } = req.body;

    await pool.query(
      `INSERT INTO sensor_logs
        (timestamp_real, timestamp_up, temperature, humidity,
         soil_moisture, "PUMP_state", "MODE_state", "Message", "Score", device_id, latency, trigger_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        timestamp_real === 'null' ? null : timestamp_real,
        timestamp_up, temperature, humidity, soil_moisture,
        PUMP_state, MODE_state, Message, Score,
        device_id || 'test',
        latency !== undefined ? latency : null,
        trigger_source || 'sensor'
      ]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ─── Admin API: xem danh sách thiết bị (Admin + User) ──────
app.get('/admin/api/devices', requireLogin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (device_id)
        device_id, temperature, humidity, soil_moisture,
        "PUMP_state", "MODE_state", "Message", "Score",
        timestamp_real, timestamp_up
      FROM sensor_logs
      ORDER BY device_id, timestamp_up DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin API: lịch sử thiết bị (Admin + User) ────────────
app.get('/admin/api/devices/:device_id/history', requireLogin, async (req, res) => {
  try {
    const { device_id } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 60, 200);
    const result = await pool.query(`
      SELECT temperature, humidity, soil_moisture,
             "PUMP_state", "MODE_state", "Message", "Score",
             timestamp_real, timestamp_up
      FROM sensor_logs
      WHERE device_id = $1
      ORDER BY timestamp_up DESC
      LIMIT $2
    `, [device_id, limit]);
    res.json(result.rows.reverse());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin API: xóa thiết bị (CHỈ Admin) ──────────────────
app.delete('/admin/api/devices/:device_id', requireLogin, requireAdmin, async (req, res) => {
  try {
    const { device_id } = req.params;
    await pool.query('DELETE FROM sensor_logs WHERE device_id = $1', [device_id]);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Device credentials: xác minh mật khẩu thiết bị (Admin + User) ───
app.post('/admin/api/devices/:device_id/verify', requireLogin, async (req, res) => {
  try {
    const { device_id } = req.params;
    const { password } = req.body;
    const result = await pool.query(
      'SELECT password FROM device_credentials WHERE device_id = $1',
      [device_id]
    );
    if (result.rows.length === 0) return res.json({ ok: false, reason: 'no_password' });
    res.json({ ok: result.rows[0].password === password });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Device credentials: đặt mật khẩu thiết bị (CHỈ Admin) ───
app.post('/admin/api/devices/:device_id/password', requireLogin, requireAdmin, async (req, res) => {
  try {
    const { device_id } = req.params;
    const { password } = req.body;
    if (!password || password.trim() === '') return res.status(400).json({ error: 'password required' });
    await pool.query(
      `INSERT INTO device_credentials (device_id, password)
       VALUES ($1, $2)
       ON CONFLICT (device_id) DO UPDATE SET password = EXCLUDED.password`,
      [device_id, password]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin API: quản lý tài khoản hệ thống (CHỈ Admin) ────
app.get('/admin/api/users', requireLogin, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, created_at FROM system_users ORDER BY created_at ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/api/users', requireLogin, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || !['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Thiếu thông tin hoặc role không hợp lệ.' });
    }
    await pool.query(
      'INSERT INTO system_users (username, password, role) VALUES ($1, $2, $3)',
      [username.trim(), password, role]
    );
    res.sendStatus(201);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại.' });
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/admin/api/users/:id', requireLogin, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    // Không cho phép xóa chính mình
    if (parseInt(id) === req.session.user.id) {
      return res.status(400).json({ error: 'Không thể xóa tài khoản đang đăng nhập.' });
    }
    await pool.query('DELETE FROM system_users WHERE id = $1', [id]);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('API running on port 3000'));