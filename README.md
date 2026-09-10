# LLM Usage Metering & Billing Service

A tenant-isolated billing backend with idempotent meters, monthly quotas, exact integer cost math, test-mode checkout, verified/deduplicated Stripe-style webhooks, and a durable reconciliation job.

```text
billable request -> quota -> unique usage event -> exact rollup
checkout -> signed webhook -> replay guard -> subscription mirror
                         reconciliation job -> mismatch alert
```

## Run

Requires Node.js 24+ and no dependencies.

```bash
npm run seed
npm start
```

Use `Authorization: Bearer reviewer-demo-token`, `X-Tenant-Id: demo`, and an `Idempotency-Key` on billable/job requests. `npm test` runs every published acceptance probe.

## Plans and pricing

Free: 1,000 API calls and 100,000 AI tokens/month. Pro: 50,000 calls and 5,000,000 tokens/month. Prices in `src/config.js` are integer microcents: input 50/token, cached input 5/token, output 200/token, reasoning 200/token, API call 100/call. Reasoning is priced as output; cached input is discounted and never collapsed into ordinary input.

## Limitations

The checkout URL and webhook source are deterministic Stripe test fixtures; no real payment is attempted. Production would replace only the Stripe gateway while preserving the verified event contract.
