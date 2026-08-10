-- Seed initial admin user for content-admin-api.
-- BCrypt hash below corresponds to password: admin123  (cost=12)
-- Change the password immediately after first login.
--
-- Apply:
--   docker exec -i local-dev-postgres psql -U postgres -d bible_timeline \
--     < resources/sql/seed_admin_user.sql

INSERT INTO content.admin_users (email, pwd_hash)
VALUES (
  'admin@bibletimeline.local',
  '$2a$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'
)
ON CONFLICT (email) DO NOTHING;
