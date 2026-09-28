# Scheduling and Alerts: Design

Date: 2026-09-27. Status: approved in conversation (Q24–Q28).

Six features, shipped in this order, one pull request each:

| Order | ID  | Feature                         | Plan                                             |
| ----- | --- | ------------------------------- | ------------------------------------------------ |
| 1     | T54 | Account label                   | `plans/2026-09-27-account-label.md`              |
| 2     | T45 | Work hours                      | `plans/2026-09-27-work-hours.md`                 |
| 3     | T46 | Weekly limit awareness          | `plans/2026-09-27-weekly-limit.md`               |
| 4     | T47 | Token expiry warnings           | `plans/2026-09-27-token-expiry.md`               |
| 5     | T48 | Unrecognised rate-limit fields  | `plans/2026-09-27-rate-limit-probe.md`           |
| 6     | T53 | Persisted schedule              | `plans/2026-09-27-persisted-schedule.md`         |

## Background: how a window works

A usage window starts with the first prompt after the previous window resets,
and lasts about 5 hours; reported resets are not on the hour (a real one was
13:50:00Z). A pulse at 06:00:10 opens a window that resets around 11:00. The
next pulse lands just after the reported reset (10 s buffer), so windows
chain: 06–11, 11–16, 16–21.

Each pulse's `rate_limit_event` carries, as observed on a real pulse:

```json
{
  "status": "allowed",
  "resetsAt": 1790257800,
  "rateLimitType": "five_hour",
  "unifiedWindows": {
    "five_hour": { "utilization": 0.48, "resetsAt": 1790257800 },
    "seven_day": { "utilization": 0.2, "resetsAt": 1790416800 }
  }
}
```

`status` is `allowed`, `allowed_warning` or `rejected`. On `rejected`,
`resetsAt` is when the blocking limit lifts, and the scheduler already waits
for it, whichever limit it is.

## 1. Account label (T54, Q24 a)

Several accounts run as one container each, each with its own
`claudepulse.env`. No scheduler change.

- New optional setting `ACCOUNT_LABEL` (1–32 characters: letters, digits,
  space, `.`, `_`, `-`).
- When set, every log line shows `[<label>]` after the level, error alerts are
  titled `🚨 claudepulse (<label>) Error`, and window notifications are titled
  `<label> · <title>`.
- README gains a "Several Accounts" section with a two-service compose
  example (distinct `container_name`, env file and `ACCOUNT_LABEL`).

## 2. Work hours (T45, Q25/Q28 A)

Goal: at the start of the working day, the current window has a chosen number
of hours left, and the next reset follows soon after, so the morning gets two
budgets. No pulses outside working hours or on days off.

Settings (all optional; the feature is on when `WORK_START` is set):

| Setting               | Format          | Default  | Meaning                                    |
| --------------------- | --------------- | -------- | ------------------------------------------ |
| `WORK_START`          | `HH:MM`         | unset    | When the working day starts (local `TZ`)   |
| `WORK_END`            | `HH:MM`         | required with `WORK_START` | No window starts at or after this time |
| `HOURS_LEFT_AT_START` | integer 1–5     | `5`      | Hours left in the window at `WORK_START`, at least |
| `WORK_DAYS`           | e.g. `Mon-Fri`  | every day | Days with a working day; ranges and commas, e.g. `Mon-Thu,Sat` |

Rules:

- **Day-start pulse.** Target reset = `WORK_START + HOURS_LEFT_AT_START`,
  rounded up to the hour. The day-start pulse fires at target reset − 5 h, at
  `:00:10`. `09:00` + 2 → reset 11:00 → pulse 06:00:10. `09:30` + 2 → reset
  12:00 → pulse 07:00:10 (2.5 h left).
- **Active period** of a working day: from its day-start pulse (inclusive) to
  `WORK_END` (exclusive). It may begin the previous calendar day when
  `WORK_START` is early; the working day's weekday decides `WORK_DAYS`.
- **Constraint.** Every planned pulse time `t` becomes the earliest time
  ≥ `t` inside an active period: unchanged if already inside, otherwise the
  next working day's day-start pulse. This keeps "never pulse before a
  rejected limit lifts", because the result is never earlier than `t`.
- **Startup.** The startup pulse is sent only inside an active period.
  Outside, the scheduler logs the next day-start pulse and waits.
- **Validation.** `WORK_END` must be after `WORK_START` on the same day.
  `WORK_START` and `SCHEDULED_START_HOUR` cannot both be set.
  `WORK_END`, `WORK_DAYS` and `HOURS_LEFT_AT_START` require `WORK_START`.
- A newly scheduled time moved by the constraint is logged with strategy
  `work_hours`.

## 3. Weekly limit awareness (T46)

- The executor reads `unifiedWindows.seven_day` into
  `rateLimit.weekly = { utilization, resetsAt }` (null when absent) and keeps
  `rateLimitType` as `rateLimit.limitType`.
- A rejected pulse is a **weekly** rejection when `limitType === "seven_day"`,
  or when `resetsAt` equals `weekly.resetsAt`.
- Window notifications:
  - weekly rejection → title "Weekly limit reached", level WARN, lift time
    shown with date (`<t:…:F>`) and countdown;
  - "Window open" gains a line `Weekly usage: 20% · resets <t:…:R>` when the
    weekly window is known.
- The pulse log line shows `weekly=20%`.
- Scheduling is unchanged: a rejection already waits for `resetsAt`.

## 4. Token expiry warnings (T47, Q26 a)

- New optional setting `TOKEN_EXPIRES_AT` (`YYYY-MM-DD`, local midnight).
- A token monitor checks at startup and then hourly. It sends one Discord
  alert per threshold crossed: 14, 7 and 1 day(s) left, and 0 (expired).
  Days left = ceiling of (expiry − now) / 24 h.
- Alerts go to `DISCORD_WEBHOOK_URL` (level WARN; ERROR once expired) and to
  the log; without a webhook, the log only. Sent thresholds are kept in
  memory, so a restart re-sends the current threshold once.
- An authentication rejection names the fix: "Token rejected - run
  `claude setup-token`, update claudepulse.env and recreate the container".

## 5. Unrecognised rate-limit fields (T48)

No sample exists of what a pulse reports when extra usage (paid credits) is in
play, so this step only gathers evidence.

- The executor keeps `rateLimit.unrecognised`: the `rate_limit_info` fields
  other than `status`, `resetsAt`, `utilization`, `rateLimitType`,
  `unifiedWindows`, with their values.
- The scheduler logs them at WARN once per distinct set of field names, as
  "Unrecognised rate-limit fields".
- A follow-up design decides whether to skip pulses while extra usage is
  active, from the fields this surfaces.

## 6. Persisted schedule (T53, Q27 a)

- New optional setting `STATE_DIR`. When set, the scheduler writes
  `<STATE_DIR>/state.json` after every scheduling decision:
  `{ "version": 1, "nextPulseAt": ISO, "rateLimit": {…}, "savedAt": ISO }`,
  written to a temp file then renamed.
- At startup, a saved `nextPulseAt` still in the future replaces the startup
  pulse: the saved rate-limit state is restored and the pulse is scheduled at
  that time (strategy `restored`, then the work-hours constraint).
  A past, missing or unreadable state starts as today; an unreadable file is
  logged at WARN.
- The image creates `/data` owned by the `claudepulse` user, so a named
  volume mounted there is writable. The compose file documents
  `STATE_DIR=/data` with a named volume.

## Out of scope

- Pausing or triggering pulses remotely (T50), other notification targets
  (T51), digests (T52), several accounts in one process.
