# Programme Team & Entitlements Contract

The Programme Workspace remains a scoped operating environment on the central Business Doctor / Business Health engine.

## Team model

Workspace membership is programme-scoped. Supported workspace roles are:

- PROGRAMME_MANAGER
- ASSESSOR
- EXPERT
- COACH
- REVIEWER
- FINANCE
- MEL

Workspace management remains restricted to the PROGRAMME_MANAGER role (plus platform ADMIN through the existing RBAC boundary). Delivery access is distinct from workspace management.

## Entitlement model

Entitlements are configuration-driven so package limits can evolve without a new database table for every commercial package. The workspace configuration may contain:

```json
{
  "entitlements": [
    { "key": "participant_capacity", "limit": 100 },
    { "key": "expert_capacity", "limit": 5 },
    { "key": "coach_capacity", "limit": 10 },
    { "key": "funder_reporting", "limit": true }
  ]
}
```

No default capacity is imposed when a role-specific entitlement is absent. This prevents accidental blocking of existing programmes.

## Enforcement

- Participant capacity is enforced when adding participants.
- Role-specific team capacity is enforced when adding a member.
- Deactivated memberships are reactivated rather than duplicated.
- Current team usage and configured limits are exposed through the workspace entitlement endpoint.
- Entitlements do not override RBAC; both permission and workspace scope remain required.

## Boundary

This slice does not create a second billing or pricing engine. Commercial package definitions can later populate the workspace configuration through the governed programme configuration flow.
