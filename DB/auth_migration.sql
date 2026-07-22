-- System Accounts Table (Admin & User)
CREATE TABLE IF NOT EXISTS system_users (
  id       SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,          -- plain-text (thay bằng bcrypt khi production)
  role     TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Grant privileges to iot_user
GRANT ALL PRIVILEGES ON TABLE system_users TO iot_user;
GRANT USAGE, SELECT ON SEQUENCE system_users_id_seq TO iot_user;

-- Default accounts (change the passwords after deployment)
-- Default administrator: admin / admin123
-- Default user: user / user123
INSERT INTO system_users (username, password, role) VALUES
  ('admin', '123456', 'admin'),
  ('user1',  '123456',  'user')
ON CONFLICT (username) DO NOTHING;