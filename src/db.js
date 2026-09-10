import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subscriptions(
      tenant_id TEXT PRIMARY KEY,plan TEXT NOT NULL DEFAULT 'free',status TEXT NOT NULL DEFAULT 'active',
      stripe_customer_id TEXT,stripe_subscription_id TEXT,updated_at TEXT NOT NULL,
      FOREIGN KEY(tenant_id) REFERENCES tenants(id));
    CREATE TABLE IF NOT EXISTS usage_events(
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,kind TEXT NOT NULL,quantity INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cost_microcents INTEGER NOT NULL,idempotency_key TEXT NOT NULL,period TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(tenant_id,idempotency_key),FOREIGN KEY(tenant_id) REFERENCES tenants(id));
    CREATE INDEX IF NOT EXISTS idx_usage_tenant_period_kind ON usage_events(tenant_id,period,kind);
    CREATE TABLE IF NOT EXISTS checkout_sessions(
      id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,plan TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS webhook_events(
      event_id TEXT PRIMARY KEY,type TEXT NOT NULL,processed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,type TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,alert TEXT,idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
  `);
  return db;
}
