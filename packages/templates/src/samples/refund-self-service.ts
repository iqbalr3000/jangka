import type { DocType } from "../index";

/** A finished example document: markdown per section key of the latest built-in template. */
export type SampleDocument = {
  docType: DocType;
  title: string;
  sections: Record<string, string>;
};

const mermaid = (source: string) => `\`\`\`mermaid\n${source.trim()}\n\`\`\``;

const brd: SampleDocument = {
  docType: "brd",
  title: "Refund self-service",
  sections: {
    executive_summary: `Customers can't request a refund themselves today: every request goes through support by email or chat, takes 7 days on average, and costs about $9 to handle. This document proposes self-service refunds in the web and mobile app for orders within the return window, with automatic approval for low-risk cases.`,

    business_problem: `- Refund requests are the largest support category: 31% of tickets (≈ 4,200 a month).
- The average time to a refund decision is 7 days; refund delays are the top reason for 1–2 star reviews.
- Agents re-key order data by hand, which causes about 3% of refunds to go to the wrong payment method.`,

    business_objectives: `- Cut the time from request to refund decision from 7 days to under 1 day.
- Reduce refund-related support tickets by 60% within two quarters of launch.
- Keep refund fraud losses at or below today's level (0.4% of refunded value).`,

    stakeholders: `| Stakeholder | Interest | Role |
| --- | --- | --- |
| Customer Support (Head of CX) | Fewer tickets, faster resolution | Sponsor |
| Finance (Payments lead) | Correct payouts, fraud stays flat | Approver |
| Product (Checkout team) | Owns the order and refund flows | Delivery |
| Risk & Fraud | Rules for automatic approval | Consulted |
| Customers | Fast, transparent refunds | End users |`,

    current_state: `1. The customer emails or chats with support.
2. An agent finds the order, checks the return window and asks for photos when the item is damaged.
3. The agent submits a refund form; Finance approves anything over $200 once a day.
4. The refund is issued manually in the payment provider's dashboard.

There is no status the customer can check, so 40% of refund tickets get a follow-up "any update?" message.`,

    proposed_solution: `Customers start a refund from the order page. Low-risk requests are approved automatically; the rest go to an agent queue with the order data already attached. The customer sees the status at every step.

${mermaid(`
flowchart LR
  A[Customer opens order] --> B[Request refund]
  B --> C{Low risk?}
  C -- Yes --> D[Approved automatically]
  C -- No --> E[Agent review queue]
  E --> F{Approved?}
  F -- Yes --> D
  F -- No --> G[Declined with reason]
  D --> H[Refund issued to original payment method]
`)}`,

    business_requirements: `| ID | Requirement | Priority |
| --- | --- | --- |
| BR-001 | Customers can request a refund for an eligible order without contacting support. | Must |
| BR-002 | Low-risk refund requests are decided automatically within minutes. | Must |
| BR-003 | Customers can see the status of their refund request at any time. | Must |
| BR-004 | Refunds go back to the original payment method only. | Must |
| BR-005 | Agents review the remaining requests with all order data attached. | Should |
| BR-006 | Finance can report on refunded value and approval reasons per week. | Could |`,

    scope: `**In scope:** physical-goods orders paid by card or wallet, within the 30-day return window, in the web and mobile apps.

**Out of scope:** marketplace (third-party seller) orders, store-credit refunds, partial refunds of bundles, and exchanges.`,

    constraints: `- The payment provider's refund API is rate-limited to 50 requests per second.
- Finance policy requires a human approval for refunds over $500.
- The mobile release train ships every two weeks; the app needs a forced-update path for the new screens.`,

    assumptions: `- At least 70% of refund requests qualify as low risk under the current fraud rules.
- Customers will accept a refund decision without speaking to an agent when the status is clear.
- The order service exposes the return window and payment method for every order.`,

    risks: `| Risk | Impact | Mitigation |
| --- | --- | --- |
| Automatic approval is abused | Higher fraud losses | Start with conservative rules; daily fraud review for the first month |
| Payment provider outages | Refunds stuck as "approved" | Retry queue and a visible "processing" status |
| Agents lose context on escalated cases | Slower reviews | Attach order history and photos to every queued request |`,

    success_criteria: `- Median time to decision < 1 day, and < 10 minutes for automatic approvals, 8 weeks after launch.
- Refund tickets down 60% versus the same weeks last year.
- Fraud losses ≤ 0.4% of refunded value.
- Refund flow CSAT ≥ 4.3 / 5.`,

    cost_benefit: `- **Cost:** about 14 engineer-weeks plus a fraud rules review; no new vendors.
- **Benefit:** ≈ 2,500 fewer tickets a month at $9 each — about $270k a year — plus faster refunds, which drive the lowest app-store ratings today.
- **Payback:** within the first two quarters.`,
  },
};

const prd: SampleDocument = {
  docType: "prd",
  title: "Refund self-service",
  sections: {
    overview: `Self-service refunds let customers request a refund from the order page, get low-risk requests approved automatically, and follow the status until the money is back. This PRD covers web and mobile for card and wallet orders.`,

    problem: `Every refund needs a support conversation today. It takes 7 days on average, generates 31% of all tickets, and customers can't see what is happening in the meantime (see the BRD for the business case).`,

    goals: `| Goal | Metric | Target |
| --- | --- | --- |
| Faster decisions | Median time from request to decision | < 1 day (automatic: < 10 min) |
| Fewer tickets | Refund-related tickets per month | −60% |
| Safe automation | Fraud losses on refunded value | ≤ 0.4% |
| Clear status | "Any update?" follow-ups on refunds | −80% |`,

    personas: `- **Returning shopper (primary):** orders monthly on mobile, wants the money back without chatting.
- **Support agent:** reviews the requests the rules don't approve; needs all order data in one place.
- **Finance analyst:** reconciles refunds weekly and audits approval reasons.`,

    user_stories: `- As a shopper, I can request a refund from my order page by choosing the items and a reason.
- As a shopper, I can see whether my refund was approved and when the money will arrive.
- As an agent, I can approve or decline a queued request with the order history in view.
- As a finance analyst, I can export refunds with their approval reason and decision time.`,

    functional_requirements: `| ID | Requirement | Priority | Upstream |
| --- | --- | --- | --- |
| FR-001 | The order page shows "Request refund" for items inside the 30-day window that weren't refunded yet. | Must | BR-001 |
| FR-002 | The request form asks for the items, a reason from a fixed list, and optional photos (up to 3). | Must | BR-001 |
| FR-003 | Requests that meet the low-risk rules are approved automatically. | Must | BR-002 |
| FR-004 | Other requests enter the agent queue with order history, photos and the customer's refund history. | Should | BR-005 |
| FR-005 | The customer sees the status (Requested, In review, Approved, Declined, Refunded) on the order page and receives an email at each change. | Must | BR-003 |
| FR-006 | Approved refunds are issued to the original payment method through the payment provider. | Must | BR-004 |
| FR-007 | A weekly export lists refunds with amount, reason, decision, approver and decision time. | Could | BR-006 |`,

    non_functional_requirements: `| ID | Requirement | Priority | Upstream |
| --- | --- | --- | --- |
| NFR-001 | p95 latency of the request submission API < 300 ms at 50 requests per second. | Must | BR-002 |
| NFR-002 | Automatic decisions are made within 2 minutes of submission for 99% of requests. | Must | BR-002 |
| NFR-003 | Every decision is recorded with its rule or approver and kept for 7 years. | Must | BR-006 |
| NFR-004 | The refund screens meet WCAG 2.1 AA on web and mobile. | Should | BR-003 |`,

    user_flow: `${mermaid(`
flowchart TD
  A[Order page] --> B[Request refund]
  B --> C[Choose items and reason]
  C --> D{Low-risk rules pass?}
  D -- Yes --> E[Approved]
  D -- No --> F[In review]
  F --> G{Agent decision}
  G -- Approve --> E
  G -- Decline --> H[Declined with reason]
  E --> I[Refund issued]
  I --> J[Refunded]
`)}

The status on the order page and the emails follow the same states.`,

    out_of_scope: `- Marketplace orders and exchanges.
- Store credit as a refund option.
- Changing the return window or fraud rules themselves.`,

    assumptions: `- The order service returns the return window, items and payment method in one call.
- The fraud team delivers the low-risk rules before development starts.
- The payment provider's refund API supports idempotency keys.`,

    risks: `| Risk | Mitigation |
| --- | --- |
| Rules approve too much in week one | Launch to 10% of customers; review automatic approvals daily |
| Customers pick the wrong items | Confirmation step listing items and the refund amount |
| Emails land in spam | Status is always visible on the order page as well |`,

    open_questions: `- Should declined requests offer a "talk to support" button, or only an email reply?
- Do photos need to be kept after the refund is decided, and for how long?`,
  },
};

const tsd: SampleDocument = {
  docType: "tsd",
  title: "Refund self-service",
  sections: {
    overview: `This TSD describes how the refunds service implements the self-service refund PRD: request intake, automatic decisions, the agent queue and payouts through the payment provider.`,

    architecture: `A new **refunds service** owns refund requests. It reads orders from the order service, asks the risk service for a decision, and pays out through the payment gateway. Status changes are published as events for notifications and reporting.

${mermaid(`
flowchart LR
  App[Web and mobile app] --> API[API gateway]
  API --> R[Refunds service]
  R --> O[Order service]
  R --> K[Risk service]
  R --> P[Payment gateway]
  R --> DB[(Refunds DB)]
  R --> Q[[Event bus]]
  Q --> N[Notification service]
  Q --> W[Reporting]
`)}`,

    components: `- **Refunds service** (new, TypeScript): API, state machine, decision orchestration, payout worker.
- **Risk service** (existing): new \`refund_low_risk\` rule set returning approve / review.
- **Agent console** (existing): new "Refund requests" queue view.
- **Notification service** (existing): three new email templates.`,

    technical_requirements: `| ID | Requirement | Priority | Upstream |
| --- | --- | --- | --- |
| TR-001 | \`POST /refunds\` validates eligibility against the order service and stores the request in one transaction. | Must | FR-001, FR-002 |
| TR-002 | The state machine allows only Requested → In review / Approved / Declined → Refunded and rejects every other transition. | Must | FR-005 |
| TR-003 | Each request calls the risk service; "approve" moves it to Approved within the request, "review" to the agent queue. | Must | FR-003, NFR-002 |
| TR-004 | The payout worker calls the gateway with the refund id as idempotency key and retries with backoff for 24 hours. | Must | FR-006 |
| TR-005 | Every transition is written to an append-only decision log with actor or rule id. | Must | NFR-003 |
| TR-006 | The submission endpoint is served from cache-free reads with a connection pool sized for 50 rps at p95 < 300 ms. | Should | NFR-001 |`,

    data_model: `${mermaid(`
erDiagram
  REFUND_REQUEST ||--|{ REFUND_ITEM : contains
  REFUND_REQUEST ||--o{ DECISION_LOG : records
  REFUND_REQUEST ||--o| PAYOUT : pays
  REFUND_REQUEST {
    uuid id
    uuid order_id
    string status
    string reason
    int amount_cents
  }
  REFUND_ITEM {
    uuid id
    uuid order_item_id
    int quantity
  }
  DECISION_LOG {
    uuid id
    string from_status
    string to_status
    string actor
  }
  PAYOUT {
    uuid id
    string gateway_ref
    string state
  }
`)}`,

    api_design: `| Method | Path | Purpose |
| --- | --- | --- |
| POST | /refunds | Create a request (items, reason, photo ids) |
| GET | /refunds/:id | Status and timeline for the customer |
| GET | /orders/:id/refunds | Requests for an order (order page) |
| POST | /refunds/:id/decision | Agent approve / decline with a note |

Errors follow the platform shape \`{ "error": { "code", "message" } }\`; \`409 not_eligible\` when the window closed or the items were already refunded.`,

    key_sequences: `${mermaid(`
sequenceDiagram
  participant C as Customer app
  participant R as Refunds service
  participant O as Order service
  participant K as Risk service
  participant P as Payment gateway
  C->>R: POST /refunds
  R->>O: Get order and return window
  O-->>R: Order, items, payment method
  R->>K: Assess request
  K-->>R: approve
  R-->>C: 201 Approved
  R->>P: Refund with idempotency key
  P-->>R: Refund succeeded
  R-->>C: Status Refunded (email)
`)}`,

    non_functional_design: `- **Latency:** eligibility and risk calls run in parallel; a 150 ms timeout on the risk service falls back to "review".
- **Reliability:** payouts are asynchronous; a request is never shown as Refunded before the gateway confirms.
- **Auditability:** the decision log is append-only and replicated to the reporting warehouse nightly.
- **Accessibility:** the new screens reuse the design-system form and status components.`,

    infrastructure: `- Deployed as one service with two processes (API, payout worker) on the existing Kubernetes cluster.
- Postgres database \`refunds\` on the shared managed cluster; no new infrastructure vendors.
- Feature flag \`refund_self_service\` per country and percentage.`,

    observability: `- Metrics: requests by status, automatic approval rate, time to decision, payout failures.
- Alerts: payout failures > 1% over 15 minutes; automatic approval rate outside 60–85% for an hour.
- Traces across order, risk and payment calls, keyed by refund id.`,

    rollout: `1. Internal staff only (one week).
2. 10% of customers in one country; daily review of automatic approvals with the fraud team.
3. 50%, then 100% once fraud losses stay ≤ 0.4% for two weeks.
4. Remove the old support refund form after four weeks at 100%.`,

    testing: `- Unit tests for every state-machine transition and eligibility rule.
- Contract tests against the order, risk and payment gateway APIs.
- End-to-end test of request → automatic approval → refunded on web and mobile.
- Load test of \`POST /refunds\` at 2× the expected peak (100 rps).`,

    risks: `- **Risk service latency** could slow submissions; mitigated by the timeout and fallback to review.
- **Gateway refund limits** per merchant account need confirming with Finance before 50% rollout.
- **Open question:** keep photos for 90 days or until the decision? (PRD open question.)`,
  },
};

/** A linked BRD → PRD → TSD for a fresh instance; each document's source is the previous one. */
export const sampleDocuments: readonly SampleDocument[] = [brd, prd, tsd];
