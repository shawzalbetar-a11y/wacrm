-- ============================================================
-- 040_add_gemini_provider.sql
-- Add 'gemini' (Google Gemini) to allowed AI providers on ai_configs
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_configs_provider_check'
  ) THEN
    ALTER TABLE ai_configs DROP CONSTRAINT ai_configs_provider_check;
  END IF;

  ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'gemini'));
END $$;
