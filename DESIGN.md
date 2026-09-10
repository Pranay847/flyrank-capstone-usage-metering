# Design

The system prevents two expensive billing failures: charging a retried request twice and trusting an unverified payment event. HTTP, billing policy, and SQLite repositories are separated. Usage is tenant-scoped, monthly, and uniquely keyed by `(tenant_id, idempotency_key)`. Money is stored as integer microcents.

Stripe test-mode behavior is represented by a checkout-session boundary and a signed webhook fixture, so every signature, replay, ordering, and plan-sync rule is testable without real money. A durable reconciliation job detects local/Stripe drift. Invoicing and proration are explicit non-goals.
