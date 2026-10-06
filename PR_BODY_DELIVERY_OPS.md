## Programme Delivery Operations

Builds the next Programme Operating System layer after cohort and delivery configuration: the operational execution of configured cohorts.

### Included
- Versioned migration `0042_delivery_operations.sql`
- Cohort delivery activities with owner, sequence, schedule and lifecycle status
- Delivery sessions with facilitator, delivery mode, time, location/meeting URL and capacity
- Participant attendance with cohort validation and upsert semantics
- Delivery operation audit events
- Service-layer programme/cohort scoping and existing RBAC controls
- API endpoints for activities, sessions, statuses and attendance
- Schema registration and a focused invariant test

### Governance boundary
This is an operational layer over the existing Programme Workspace and central Business Health engine. It does not create a second diagnostic, scoring, prescription, case, BHR or certification engine.

### Safety
- Migration is staging-gated.
- No production migration should be applied from this PR.
- Existing cohort and participant lifecycle remains authoritative.
- Delivery records are append/history oriented; status reopening is restricted for completed records.
