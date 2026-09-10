import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { plans, pricing, tokenCost } from './config.js';

const month = () => new Date().toISOString().slice(0, 7);
const fail = (status, message) => Object.assign(new Error(message), { status });

export class BillingService {
  constructor(db, webhookSecret = 'whsec_fixture_only') { this.db = db; this.webhookSecret = webhookSecret; }

  ensureTenant(id, name = id) {
    this.db.prepare('INSERT OR IGNORE INTO tenants(id,name) VALUES(?,?)').run(id, name);
    this.db.prepare(`INSERT OR IGNORE INTO subscriptions(tenant_id,plan,status,updated_at) VALUES(?,'free','active',?)`).run(id, new Date().toISOString());
  }

  subscription(tenant) {
    this.ensureTenant(tenant);
    return this.db.prepare('SELECT * FROM subscriptions WHERE tenant_id=?').get(tenant);
  }

  rollup(tenant) {
    const sub = this.subscription(tenant); const limits = plans[sub.plan];
    const rows = this.db.prepare(`SELECT kind,SUM(quantity) quantity,SUM(cost_microcents) cost FROM usage_events WHERE tenant_id=? AND period=? GROUP BY kind`).all(tenant, month());
    const used = { api_calls: 0, ai_tokens: 0 }; let cost_microcents = 0;
    for (const row of rows) { used[row.kind] = row.quantity; cost_microcents += row.cost; }
    return { tenant_id: tenant, plan: sub.plan, status: sub.status, period: month(), used, limits, remaining: { api_calls: limits.api_calls - used.api_calls, ai_tokens: limits.ai_tokens - used.ai_tokens }, cost_microcents, pricing };
  }

  record(tenant, key, input) {
    if (!key) throw fail(400, 'idempotency-key is required');
    if (!input || !['api_calls', 'ai_tokens'].includes(input.kind)) throw fail(400, 'kind must be api_calls or ai_tokens');
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw fail(400, 'quantity must be a positive integer');
    this.ensureTenant(tenant);
    const duplicate = this.db.prepare('SELECT * FROM usage_events WHERE tenant_id=? AND idempotency_key=?').get(tenant, key);
    if (duplicate) return { duplicate: true, event: duplicate, usage: this.rollup(tenant) };
    const usage = this.rollup(tenant); const next = usage.used[input.kind] + input.quantity;
    if (usage.status !== 'active') throw fail(402, 'subscription inactive; upgrade or restore payment');
    if (next > usage.limits[input.kind]) throw fail(429, `${input.kind} quota exceeded`);
    const parts = { input: input.input_tokens || 0, cached_input: input.cached_input_tokens || 0, output: input.output_tokens || 0, reasoning: input.reasoning_tokens || 0 };
    if (input.kind === 'ai_tokens' && Object.values(parts).some(x => !Number.isInteger(x) || x < 0)) throw fail(400, 'token categories must be non-negative integers');
    const cost = input.kind === 'api_calls' ? input.quantity * pricing.api_call : tokenCost(parts);
    const info = this.db.prepare(`INSERT INTO usage_events(tenant_id,kind,quantity,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,cost_microcents,idempotency_key,period,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(tenant,input.kind,input.quantity,parts.input,parts.cached_input,parts.output,parts.reasoning,cost,key,month(),new Date().toISOString());
    return { duplicate: false, event: this.db.prepare('SELECT * FROM usage_events WHERE id=?').get(Number(info.lastInsertRowid)), usage: this.rollup(tenant) };
  }

  checkout(tenant, plan = 'pro') {
    if (plan !== 'pro') throw fail(400, 'only the pro checkout is available');
    this.ensureTenant(tenant); const id = `cs_test_${randomUUID()}`;
    this.db.prepare('INSERT INTO checkout_sessions(id,tenant_id,plan,status,created_at) VALUES(?,?,?,?,?)').run(id,tenant,plan,'open',new Date().toISOString());
    return { id, mode: 'subscription', url: `https://checkout.stripe.test/${id}`, test_mode: true };
  }

  sign(raw) { return createHmac('sha256', this.webhookSecret).update(raw).digest('hex'); }

  webhook(raw, signature) {
    const expected = Buffer.from(this.sign(raw)); const actual = Buffer.from(signature || '');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw fail(400, 'invalid webhook signature');
    let event; try { event = JSON.parse(raw); } catch { throw fail(400, 'invalid webhook JSON'); }
    if (!event.id || !event.type || !event.data?.object) throw fail(400, 'invalid webhook event');
    if (this.db.prepare('SELECT 1 FROM webhook_events WHERE event_id=?').get(event.id)) return { duplicate: true, processed: false };
    const object = event.data.object; const tenant = object.metadata?.tenant_id;
    if (!tenant) throw fail(400, 'webhook tenant metadata missing');
    this.ensureTenant(tenant);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO webhook_events(event_id,type,processed_at) VALUES(?,?,?)').run(event.id,event.type,new Date().toISOString());
      if (event.type === 'checkout.session.completed') {
        this.db.prepare(`UPDATE subscriptions SET plan='pro',status='active',stripe_customer_id=?,stripe_subscription_id=?,updated_at=? WHERE tenant_id=?`).run(object.customer,object.subscription,new Date().toISOString(),tenant);
        if (object.id) this.db.prepare(`UPDATE checkout_sessions SET status='completed' WHERE id=? AND tenant_id=?`).run(object.id,tenant);
      } else if (event.type === 'customer.subscription.updated') {
        this.db.prepare('UPDATE subscriptions SET plan=?,status=?,stripe_subscription_id=?,updated_at=? WHERE tenant_id=?').run(object.plan || 'pro',object.status || 'active',object.id,new Date().toISOString(),tenant);
      } else if (event.type === 'customer.subscription.deleted') {
        this.db.prepare(`UPDATE subscriptions SET plan='free',status='canceled',updated_at=? WHERE tenant_id=?`).run(new Date().toISOString(),tenant);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { duplicate: false, processed: true, subscription: this.subscription(tenant) };
  }

  queueReconciliation(tenant, key) {
    this.ensureTenant(tenant);
    this.db.prepare(`INSERT OR IGNORE INTO jobs(tenant_id,type,idempotency_key,created_at) VALUES(?,'stripe_reconciliation',?,?)`).run(tenant,key,new Date().toISOString());
    return this.db.prepare('SELECT * FROM jobs WHERE idempotency_key=?').get(key);
  }

  runReconciliation(tenant, id, stripeSnapshot = {}) {
    const job = this.db.prepare('SELECT * FROM jobs WHERE id=? AND tenant_id=?').get(id, tenant); if (!job) throw fail(404, 'job not found');
    const sub = this.subscription(tenant); const alert = stripeSnapshot.plan && stripeSnapshot.plan !== sub.plan ? `plan mismatch: local=${sub.plan} stripe=${stripeSnapshot.plan}` : null;
    this.db.prepare(`UPDATE jobs SET state='completed',attempts=attempts+1,alert=? WHERE id=?`).run(alert,id);
    return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  }
}
