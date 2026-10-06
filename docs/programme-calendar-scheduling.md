# Programme Calendar & Scheduling

## Purpose

PR #69 establishes a provider-neutral calendar and scheduling foundation for Programme Workspaces. It connects existing delivery sessions to calendar records without creating a second delivery, participant, or scheduling engine.

## Boundary

The shared scheduling service owns:

- calendar connection metadata
- calendar event records
- linking events to existing delivery sessions
- schedule/cancel operations
- provider abstraction for Google, Microsoft, ICS and internal calendars
- audit history for connection and event changes

Provider authentication, OAuth token storage, vendor-specific synchronization and webhook processing remain separate integration concerns.

## Governance

- Programme/cohort access uses the existing `programme_workspaces` permission and programme scope.
- Current-user calendar connections are self-scoped.
- Calendar events are cohort-scoped through the existing Programme Workspace delivery model.
- RLS is enabled on the new tables.
- No production migration is implied by the migration file.

## Flow

`Programme Workspace -> Cohort -> Delivery Activity -> Delivery Session -> Calendar Event -> Provider`

The delivery session remains the operational source for programme delivery. The calendar event is a scheduling representation and must not become a second source of truth for participant or delivery state.
