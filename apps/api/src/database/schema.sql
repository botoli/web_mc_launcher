CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now(),
    details jsonb NOT NULL DEFAULT '{}'
);

-- Keep legacy password formats and unknown fields losslessly. Indexed columns
-- are derived from the account document and cannot drift from it.
CREATE TABLE IF NOT EXISTS users (
    login text PRIMARY KEY,
    data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    nickname text GENERATED ALWAYS AS (data->>'nickname') STORED,
    email text GENERATED ALWAYS AS (data->>'email') STORED,
    role text GENERATED ALWAYS AS (CASE WHEN login = 'botoli1' THEN 'admin' ELSE coalesce(data->>'role', 'player') END) STORED,
    registration_status text GENERATED ALWAYS AS (data->>'registrationStatus') STORED,
    registered_at bigint GENERATED ALWAYS AS ((data->>'registeredAt')::bigint) STORED,
    last_login bigint GENERATED ALWAYS AS ((data->>'lastLogin')::bigint) STORED
);
CREATE INDEX IF NOT EXISTS users_nickname_idx ON users (lower(nickname));
CREATE TABLE IF NOT EXISTS user_identities (
    login text PRIMARY KEY REFERENCES users(login) ON DELETE CASCADE,
    data jsonb NOT NULL,
    telegram_id text GENERATED ALWAYS AS (data->>'telegramId') STORED,
    discord_id text GENERATED ALWAYS AS (data->>'discordId') STORED
);
CREATE UNIQUE INDEX IF NOT EXISTS identities_telegram_idx ON user_identities(telegram_id) WHERE telegram_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS identities_discord_idx ON user_identities(discord_id) WHERE discord_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS user_moderation (
    login text PRIMARY KEY REFERENCES users(login) ON DELETE CASCADE,
    data jsonb NOT NULL,
    frozen_until bigint GENERATED ALWAYS AS ((data->>'frozenUntil')::bigint) STORED,
    reason text GENERATED ALWAYS AS (data->>'moderationReason') STORED
);
CREATE TABLE IF NOT EXISTS application_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL
);

-- The sequence preserves the original JSONL order, including equal timestamps.
-- Historical logins remain readable even if no matching account exists.
CREATE TABLE IF NOT EXISTS player_events (
    sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    data jsonb NOT NULL,
    id text GENERATED ALWAYS AS (data->>'id') STORED,
    login text GENERATED ALWAYS AS (data->>'login') STORED,
    at bigint GENERATED ALWAYS AS ((data->>'at')::bigint) STORED,
    category text GENERATED ALWAYS AS (data->>'category') STORED,
    action text GENERATED ALWAYS AS (data->>'action') STORED,
    source text GENERATED ALWAYS AS (data->>'source') STORED
);
CREATE INDEX IF NOT EXISTS events_login_time_idx ON player_events(login, at DESC);
CREATE INDEX IF NOT EXISTS events_category_time_idx ON player_events(category, at DESC);

CREATE TABLE IF NOT EXISTS telegram_challenges (
    key text PRIMARY KEY, data jsonb NOT NULL,
    login text GENERATED ALWAYS AS (data->>'login') STORED,
    status text GENERATED ALWAYS AS (data->>'status') STORED,
    expires_at bigint GENERATED ALWAYS AS ((data->>'expires_at')::bigint) STORED
);
CREATE TABLE IF NOT EXISTS telegram_sessions (
    key text PRIMARY KEY, data jsonb NOT NULL,
    login text GENERATED ALWAYS AS (data->>'login') STORED,
    telegram_id text GENERATED ALWAYS AS (data->>'telegramId') STORED,
    expires_at bigint GENERATED ALWAYS AS ((data->>'expires_at')::bigint) STORED
);
CREATE INDEX IF NOT EXISTS telegram_sessions_login_idx ON telegram_sessions(login);
CREATE INDEX IF NOT EXISTS telegram_sessions_expiry_idx ON telegram_sessions(expires_at);
CREATE TABLE IF NOT EXISTS telegram_conversations (key text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_code_attempts (key text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_password_attempts (key text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_profiles (key text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_messages (key text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_deletions (key text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_active_messages (key text PRIMARY KEY, data jsonb NOT NULL);
