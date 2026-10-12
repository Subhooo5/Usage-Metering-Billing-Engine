CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_call_limit BIGINT NOT NULL CHECK (api_call_limit >= 0),
  token_limit BIGINT NOT NULL CHECK (token_limit >= 0)
);

INSERT INTO plans (id, name, api_call_limit, token_limit) VALUES
  ('free', 'Free', 1000, 100000),
  ('pro', 'Pro', 100000, 5000000);

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL DEFAULT 'free' REFERENCES plans (id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due')),
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  status TEXT NOT NULL,
  last_event_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_tenant_idx ON subscriptions (tenant_id);

CREATE TABLE usage_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  api_calls INTEGER NOT NULL DEFAULT 1 CHECK (api_calls >= 0),
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  reasoning_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
  total_tokens BIGINT NOT NULL CHECK (total_tokens >= 0),
  cost_nano BIGINT NOT NULL CHECK (cost_nano >= 0),
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX usage_events_tenant_time_idx ON usage_events (tenant_id, created_at);

CREATE TABLE stripe_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);