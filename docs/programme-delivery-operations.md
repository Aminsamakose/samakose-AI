# Programme Delivery Operations

Delivery Operations is the execution layer after cohort configuration. It does not replace the central Business Health engine or create a second case, diagnostic, scoring, prescription or BHR system.

## Scope

- Cohort delivery activities with sequence, owner, schedule and status.
- Delivery sessions with facilitator, mode, time, location/meeting link and capacity.
- Participant attendance tied to the programme participant and session.
- Explicit lifecycle transitions for activities and sessions.
- Audit events for operational changes.
- Programme/cohort scoping through the existing service authorization layer.

## Governance boundary

Programme teams operate delivery within the approved Programme Workspace and cohort configuration. Existing RBAC, workspace scoping and audit controls remain authoritative.

The migration `0042_delivery_operations.sql` is staging-gated. Production must not be migrated until staging qualification passes.
