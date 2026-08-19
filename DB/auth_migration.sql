-- DB/auth_migration.sql
CREATE TABLE IF NOT EXISTS system_users (
  id         SERIAL PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMP DEFAULT NOW()
);

GRANT ALL PRIVILEGES ON TABLE system_users TO iot_user;
GRANT USAGE, SELECT ON SEQUENCE system_users_id_seq TO iot_user;

INSERT INTO system_users (username, password, role) VALUES
  ('admin', '123456', 'admin'),
  ('user1', '123456', 'user')
ON CONFLICT (username) DO NOTHING;