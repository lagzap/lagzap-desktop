# Server prompt: plan access data for the desktop client

Paste everything below the line into a Claude Code session opened in the
`coordinator` repo (`C:\Users\dev\lagzap\coordinator`).

---

The LagZap desktop client is adding plan-based access: some titles, profiles
and servers are hidden from most users, some are shown locked with an unlock
button, and plans limit internet count, route count and route depth. The
client enforces all of it; the server only has to send the data below. Do not
change how relays authorize traffic in this task.

## What exists

- `GET /data` (`auth/user.go`, `DataResponse`) already sends
  `plan_node_group_ids` (from `node_group_plan`) and
  `subscriber_node_group_ids` (from `node_group_subscriber`). The client
  merges both into the user's access groups.
- Profiles carry `node_group_ids` (`node_group_profile`, sent in the
  `Profile` proto). A relay is usable for a profile when it is in one of the
  profile's groups and one of the user's access groups.
- `plans` has `routes`, `devices`, `fair_traffic` and a `metadata` jsonb
  column. The subscription (`subscribers.status`, `plan_id`, `ends_at`,
  `trial_ends_at`) is read in `Data` but not sent.
- The client already reads top-level `max_hops` and `max_internets` from
  `/data`, but the server never sends them.

## 1. Node group tiers

Add `tier` to `node_groups`: `'standard'` (default), `'premium'` or
`'private'`. Optionally add `upsell` (short text, e.g. "Premium Frankfurt
servers").

- `premium`: users without access see these servers, and the profiles and
  titles that only use them, with a lock and an unlock button.
- `private`: users without access never see them. Use these for special plans
  or people an admin grants access to (`node_group_subscriber`).

Make sure the client receives every node group, including ones the user has
no access to, so it can tell premium from private. Check
`HandleGetNodeGroupsRequest`.

## 2. `/data` additions

Keep every existing field. Add:

```json
{
  "max_hops": 3,
  "max_internets": 2,
  "max_routes": 3,
  "plan": {
    "id": 3,
    "name": "Pro",
    "status": "active",
    "expires_at": "2026-12-01T00:00:00Z",
    "features": ["deep_routing"],
    "upgrade_url": "https://lagzap.com/pricing"
  },
  "node_group_tiers": {
    "<node_group_id>": { "tier": "premium", "upsell": "Premium Frankfurt servers" }
  }
}
```

- `max_hops`, `max_internets`, `max_routes`: from the subscriber's plan. `0`
  or absent means no limit. `max_hops` is the route level, the servers a
  route passes including the relay: 1 Basic (relay only), 2 Advanced (one
  entry server), 3 Ultimate (two). `max_routes` comes from `plans.routes`. Put the
  other two in new plan columns or in `plans.metadata`, whichever fits the
  schema. Admins (`status == "admin"`) get `0` for all three.
- `plan.status`: one of `active`, `trial`, `expired`, `none`, `admin`.
  Compute `expired` from `ends_at` / `trial_ends_at` against the current
  time, and `none` when there is no `plan_id`. The client routes nothing
  unless the status is `active`, `trial` or `admin`, and treats a missing
  `plan` as `none` (even free is a plan), so every non-admin subscriber with
  a plan must get this block. Admins are recognized by the existing `admin`
  ability in `abilities` and get full access even without a plan.
- `plan.features`: string flags from `plans.metadata` (e.g. `deep_routing`),
  for things the client advertises without showing numbers. Empty array when
  none.
- `plan.upgrade_url`: where the unlock button sends the user. A setting or
  constant is fine.
- `node_group_tiers`: every non-standard node group, keyed by id. Standard
  groups can be omitted.

## 3. Tests and checks

- Unit test the status computation (active, trial, expired by `ends_at`,
  expired trial, no plan, admin).
- Test that `/data` includes the new fields and that admins get no limits.
- If you add columns, add the migration in the repo's usual way.
- Report the final JSON shape and any field you named differently, so the
  client can match it.
