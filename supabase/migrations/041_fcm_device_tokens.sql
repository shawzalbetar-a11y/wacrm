-- ============================================================
-- 041_fcm_device_tokens.sql
-- Store Android & iOS FCM device tokens for push notifications
-- ============================================================

CREATE TABLE IF NOT EXISTS fcm_device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  device_type TEXT DEFAULT 'android',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fcm_device_tokens_token ON fcm_device_tokens(token);

ALTER TABLE fcm_device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service and authenticated token management" ON fcm_device_tokens;
CREATE POLICY "Allow service and authenticated token management" ON fcm_device_tokens
  FOR ALL USING (true) WITH CHECK (true);
