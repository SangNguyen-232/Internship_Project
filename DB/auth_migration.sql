-- ============================================================
-- Migration: Thêm hệ thống phân quyền Admin / User
-- Chạy sau khi DB.sql đã được khởi tạo
-- ============================================================

-- Bảng tài khoản hệ thống (Admin & User)
CREATE TABLE IF NOT EXISTS system_users (
  id       SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,          -- plain-text (thay bằng bcrypt khi production)
  role     TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cấp quyền cho iot_user
GRANT ALL PRIVILEGES ON TABLE system_users TO iot_user;
GRANT USAGE, SELECT ON SEQUENCE system_users_id_seq TO iot_user;

-- Tài khoản mặc định (đổi mật khẩu sau khi deploy)
-- Admin mặc định: admin / admin123
-- User mặc định:  user  / user123
INSERT INTO system_users (username, password, role) VALUES
  ('admin', 'admin123', 'admin'),
  ('user',  'user123',  'user')
ON CONFLICT (username) DO NOTHING;