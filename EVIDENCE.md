# Evidence

- Idempotency: `retries create exactly one usage event` proves one row after two requests.
- Quotas: `quota excess returns honest 429`; the HTTP layer adds `Retry-After`.
- Payment state: `inactive subscription returns 402`.
- Cost math: `integer cost math distinguishes cached, output, and reasoning tokens` proves the pinned total of 45,500 microcents.
- Isolation: `usage rollup is isolated by tenant`.
- Checkout/sync/replay: `signed checkout webhook upgrades tenant and replay is ignored`.
- Signature verification: `forged webhook is rejected`.
- Background durability and alerting: `reconciliation job survives storage and alerts on mismatch`.

Run `npm test`; expected: 8 pass, 0 fail.
