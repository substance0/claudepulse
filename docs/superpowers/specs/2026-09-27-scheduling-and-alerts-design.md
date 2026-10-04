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

Settings. The feature is opt-in: it is on only with `WORK_HOURS_ENABLED=true`,
and the other settings are ignored while it is off.

| Setting               | Format          | Default  | Meaning                                    |
| --------------------- | --------------- | -------- | ------------------------------------------ |
| `WORK_HOURS_ENABLED`  | `true`/`false`  | `false`  | Turns work hours on                        |
| `WORK_START`          | `HH:MM`         | required when on | When the working day starts (local `TZ`) |
| `WORK_END`            | `HH:MM`         | required when on | No window starts at or after this time |
| `HOURS_LEFT_AT_START` | integer 1–5     | `5`      | Hours left in the window at `WORK_START`   |
| `WORK_DAYS`           | e.g. `Mon-Fri`  | every day | Days with a working day; ranges and commas, e.g. `Mon-Thu,Sat` |

Rules:

- **Day-start pulse.** A window resets 5 hours after the minute of the pulse
  that opens it (observed in production). The day-start pulse fires at
  `WORK_START + HOURS_LEFT_AT_START − 5 h + 10 s`, with the 5 hours in real
  time so daylight-saving days keep the exact hours left. `09:00` + 2 →
  06:00:10 → reset 11:00. `09:30` + 2 → 06:30:10 → reset 11:30.
- **Active period** of a working day: from its day-start pulse (inclusive) to
  `WORK_END` (exclusive). It may begin the previous calendar day when
  `WORK_START` is early; the working day's weekday decides `WORK_DAYS`.
- **Constraint.** Every planned pulse time `t` becomes the earliest time
  ≥ `t` inside an active period: unchanged if already inside, otherwise the
  next working day's day-start pulse. This keeps "never pulse before a
  rejected limit lifts", because the result is never earlier than `t`.
- **Startup.** The startup pulse is sent only inside an active period.
  Outside, the scheduler logs the next day-start pulse and waits.
- **Retries.** A failing cycle stops retrying once outside an active period;
  the failure still counts toward alerts.
- **Validation (when on).** `WORK_START` and `WORK_END` are required;
  `WORK_END` must be after `WORK_START` on the same day; work hours and
  `SCHEDULED_START_HOUR` cannot both be set.
- **Warnings (never blocking).** Settings present while the feature is off;
  less than 5 hours between `WORK_END` and the next day-start pulse, which
  lets the evening window overlap the morning (suggests an earlier
  `WORK_END` or switching work hours off).
- A newly scheduled time moved by the constraint is logged with strategy
  `work_hours`, with a line naming the old and new times.

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
- A token monitor checks at startup, before the scheduler starts, and then
  hourly. It delivers one Discord alert per threshold crossed: 14, 7 and 1
  day(s) left, and 0 (expired). Days left = local calendar days from today to
  the expiry date, so clock changes do not shift a warning.
- Alerts go to `DISCORD_ERROR_WEBHOOK_URL` (level WARN; ERROR once expired) and to
  the log; without a webhook, the log only. An alert Discord did not accept
  is retried at the next check; each is logged once. Delivered thresholds are
  kept in memory, so a restart re-sends the current threshold once.
- An authentication rejection names the fix: "Token rejected - run
  `claude setup-token`, update claudepulse.env and recreate the container".

## 5. Unrecognised rate-limit fields (T48)

A real pulse (captured on an account without extra-usage credits) carries the
extra-usage fields on every event: `overageStatus: "rejected"`,
`overageDisabledReason: "out_of_credits"` and `isUsingOverage: false`. The
Claude CLI can also send `overageResetsAt`, `overageInUse`, `limitScope`,
`surpassedThreshold`, `rateLimitGraceActive`, `overagePeriodMonthly`,
`overagePeriodChannel`, `errorCode`, `canUserPurchaseCredits` and
`hasChargeableSavedPaymentMethod`.

- The executor reads `overageStatus`, `overageDisabledReason`,
  `isUsingOverage` and `overageResetsAt` into `rateLimit.overage`
  (`{status, disabledReason, using, resetsAt}`, null when absent). A pulse
  drawing on extra usage logs `overage=on`.
- The executor keeps every other field outside `status`, `resetsAt`,
  `utilization`, `rateLimitType`, `unifiedWindows` and those four as
  `rateLimit.unrecognised`, with its value.
- The scheduler logs them at WARN once per distinct set of field names, as
  "Unrecognised rate-limit fields". Values of the two billing flags
  (`canUserPurchaseCredits`, `hasChargeableSavedPaymentMethod`) are replaced
  by `[omitted]`, since operators paste the line into issues.
- Acting on extra usage, such as skipping pulses while it is in use, is a
  follow-up design (T56).

## 6. Persisted schedule (T53, Q27 a)

- New optional setting `STATE_DIR` (absolute path). When set, the scheduler
  writes `<STATE_DIR>/state.json` after every scheduling decision:
  `{ "version": 1, "nextPulseAt": ISO, "rateLimit": {status, resetsAt,
  fiveHourResetsAt, limitType, weekly}, "strategy", "fingerprint",
  "savedAt": ISO }`, each save to a temporary file of its own, then renamed.
  `strategy` is what the time was based on, before work hours moved it;
  `fingerprint` identifies the scheduling settings (work hours,
  `SCHEDULED_START_HOUR`, `IMMEDIATE_PULSE_AFTER_AUTH`, `ACCOUNT_LABEL`,
  `TZ`). The extra-usage and unknown-field parts of the rate-limit state are
  not saved.
- At startup, a saved `nextPulseAt` replaces the startup pulse, with the
  rate-limit state restored and the strategy named `restored` (then the
  work-hours constraint), only when it is still in the future and at most 15
  days ahead (a weekly lift plus days off is about two weeks), its
  fingerprint equals the current one, and its strategy was not `discovery`
  (a guess made when no window was known). Otherwise the startup runs as
  before and the log says why. An unreadable file, or one whose rate-limit
  data is not an object, is logged at WARN with the file's path. A restored
  time is used once.
- A dry run reads the same state and reports the schedule a real start would
  resume; it never writes.
- A state that cannot be saved is a WARN, and the wait for a write is bounded
  (5 s): pulsing never stops because of storage.
- The state belongs to one container: several accounts need a volume each.
- The image creates `/data` owned by the `claudepulse` user (uid 1001), so a
  named volume mounted there is writable. The compose file documents
  `STATE_DIR=/data` with a named volume.

## Out of scope

- Pausing or triggering pulses remotely (T50), other notification targets
  (T51), digests (T52), several accounts in one process.
