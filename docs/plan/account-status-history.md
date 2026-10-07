# Account status history

Atlas currently stores the latest Product organization plan and billing identifiers. It does not store the point at which those values changed. QBR therefore cannot reliably reconstruct a pilot to enterprise transition from Product DB alone.

## Event contract

`productOrganizationStatusEvent` is an append-only event log for each Product organization observed by the Metabase user sync. An event contains:

- `sourceId` and `productOrganizationId`, with the source external organization ID retained by the related organization row
- `plan`, `pilotType`, `pilotAcceptedAt`, and `pilotExpiresAt` when the source provides them
- `stripeSubscriptionId` and `stripeCustomerId` for joins to billing and RevOps evidence
- `observedAt`, the time Atlas read the source
- `effectiveAt`, the source `plan_updated_at` when supplied, otherwise `observedAt`
- `contentHash`, used to suppress unchanged polls
- `evidence`, which records the source name, source organization ID, and fields observed

The same status can appear again after an intervening change. The idempotency key includes the observation timestamp, so a free to paid to free sequence remains three events even when the first and last states match.

## Write path

`MetabaseService.persistUsers` upserts the current `ProductOrganization` row, reads the latest status event, and creates an event only when the normalized status hash changes. It runs in the same transaction as the organization and membership upserts. The user card may add `pilot_type`, `enterprise_pilot_accepted_at`, `enterprise_pilot_expires_at`, or `plan_updated_at`; absent fields remain null and are not inferred.

## Read contract

For a point-in-time account type, select the latest event whose `effectiveAt` is at or before the activity timestamp for that product organization. For a period, join an event when its half-open interval overlaps the period:

```sql
event.effectiveAt < period_end
and coalesce(lead(event.effectiveAt) over (...), 'infinity') > period_start
```

Revenue and product-generation usage should then apply the existing paid precedence rule by joining the paid RevOps registry for the same period. Pilot exclusion is a derived reporting decision; the history table does not override paid contract evidence.

## Backfill boundary

The migration creates no historical events. Existing `ProductOrganization` and `ProductUserSnapshot` rows only show the state captured at their poll time, and current pilot markers do not establish when a prior transition happened. A one-time seed can create a baseline event with `effectiveAt = observedAt` and `evidence.kind = 'baseline'`, but it must not be presented as historical transition evidence. Reliable free, pilot, enterprise, downgrade, and win-back intervals begin with the first post-migration observation. A source event timestamp should be added to the Metabase card when Product DB exposes one.

## Required source and operational follow-up

Product should emit an account status change record at the same write that changes the organization plan or pilot fields. The record needs the canonical Product organization ID, customer and subscription IDs, old and new values, an effective timestamp, and the actor or system that made the change. Atlas can ingest that event directly later; until then, the poll log gives an observed-time history with a known sync lag.
