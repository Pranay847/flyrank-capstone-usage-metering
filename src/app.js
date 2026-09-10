import http from 'node:http';
import { openDatabase } from './db.js';
import { BillingService } from './service.js';

function send(res, status, value, headers = {}) { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(value)); }
async function rawBody(req) { let raw=''; for await (const chunk of req) { raw += chunk; if (raw.length > 32768) throw Object.assign(new Error('body too large'), { status: 413 }); } return raw; }
function parsed(raw) { if (!raw) return {}; try { return JSON.parse(raw); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); } }

export function createApp(options = {}) {
  const db = options.db || openDatabase(options.databasePath || process.env.DATABASE_PATH || ':memory:');
  const service = options.service || new BillingService(db, options.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET);
  const token = options.token || process.env.AUTH_TOKEN || 'reviewer-demo-token';
  const server = http.createServer(async (req,res) => {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return send(res,200,{ok:true,service:'usage-metering'});
      if (req.method === 'POST' && url.pathname === '/webhooks/stripe') {
        const raw = await rawBody(req); return send(res,200,service.webhook(raw,req.headers['stripe-signature']));
      }
      if (req.headers.authorization !== `Bearer ${token}`) return send(res,401,{error:'unauthorized',request_id:requestId});
      const tenant = req.headers['x-tenant-id']; if (!tenant) return send(res,400,{error:'x-tenant-id is required'});
      if (req.method === 'POST' && url.pathname === '/api/generate') {
        const input = parsed(await rawBody(req));
        return send(res,201,service.record(tenant,req.headers['idempotency-key'],{kind:'ai_tokens',quantity:input.input_tokens+input.cached_input_tokens+input.output_tokens+input.reasoning_tokens,...input}));
      }
      if (req.method === 'POST' && url.pathname === '/api/calls') return send(res,201,service.record(tenant,req.headers['idempotency-key'],{kind:'api_calls',...parsed(await rawBody(req))}));
      if (req.method === 'GET' && url.pathname === '/api/usage') return send(res,200,service.rollup(tenant));
      if (req.method === 'POST' && url.pathname === '/api/checkout') return send(res,201,service.checkout(tenant,parsed(await rawBody(req)).plan));
      if (req.method === 'POST' && url.pathname === '/api/jobs/reconcile') return send(res,202,service.queueReconciliation(tenant,req.headers['idempotency-key']));
      const m=url.pathname.match(/^\/api\/jobs\/(\d+)\/run$/);
      if (req.method === 'POST' && m) return send(res,200,service.runReconciliation(tenant,Number(m[1]),parsed(await rawBody(req))));
      return send(res,404,{error:'not found',request_id:requestId});
    } catch(error) { const status=error.status||500; return send(res,status,{error:error.status?error.message:'internal error',request_id:requestId},status===429?{'retry-after':'3600'}:{}); }
  });
  return { server,db,service };
}
