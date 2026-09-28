/**
 * Work hours: when pulses are allowed, and when the first window of a working
 * day opens.
 *
 * A window lasts about 5 hours from the pulse that opens it. To have at least
 * HOURS_LEFT_AT_START hours left when work starts, the day's first pulse
 * fires 5 hours before WORK_START + HOURS_LEFT_AT_START, rounded up to the
 * hour, and never after the start of work's hour. All times are local to the
 * container's TZ.
 */

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Parse a 24-hour HH:MM clock time.
 * @param {string|undefined} text
 * @returns {{hour: number, minute: number}|null}
 */
export function parseClock(text) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text ?? "");
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

/**
 * Parse a list of days and day ranges, such as "Mon-Fri" or "Mon-Thu,Sat".
 * A range may wrap over the weekend ("Fri-Mon").
 * @param {string} text
 * @returns {Set<number>|null} Days as 0 (Sunday) to 6 (Saturday)
 */
export function parseWorkDays(text) {
  const days = new Set();

  for (const part of String(text).split(",")) {
    const [from, to = from] = part.trim().toLowerCase().split("-");
    const first = DAY_NAMES.indexOf(from);
    const last = DAY_NAMES.indexOf(to);
    if (first < 0 || last < 0) {
      return null;
    }
    for (let day = first; ; day = (day + 1) % 7) {
      days.add(day);
      if (day === last) break;
    }
  }

  return days;
}

/**
 * Validation errors for the work-hours settings, empty when they are valid
 * or unset.
 * @param {Object} config - Loaded configuration
 * @returns {string[]}
 */
export function workHoursErrors(config) {
  const errors = [];
  const { WORK_START, WORK_END, WORK_DAYS, HOURS_LEFT_AT_START } = config;

  if (WORK_START === undefined) {
    if ([WORK_END, WORK_DAYS, HOURS_LEFT_AT_START].some((v) => v !== undefined)) {
      errors.push("WORK_END, WORK_DAYS and HOURS_LEFT_AT_START require WORK_START");
    }
    return errors;
  }

  const start = parseClock(WORK_START);
  if (!start) {
    errors.push("WORK_START must be HH:MM (24-hour), e.g. 09:00");
  }

  if (WORK_END === undefined) {
    errors.push("WORK_END is required with WORK_START");
  } else {
    const end = parseClock(WORK_END);
    if (!end) {
      errors.push("WORK_END must be HH:MM (24-hour), e.g. 19:00");
    } else if (start && end.hour * 60 + end.minute <= start.hour * 60 + start.minute) {
      errors.push("WORK_END must be later than WORK_START on the same day");
    }
  }

  if (HOURS_LEFT_AT_START !== undefined && !/^[1-5]$/.test(String(HOURS_LEFT_AT_START))) {
    errors.push("HOURS_LEFT_AT_START must be a whole number from 1 to 5");
  }

  if (WORK_DAYS !== undefined && !parseWorkDays(WORK_DAYS)) {
    errors.push("WORK_DAYS must list days or ranges, e.g. Mon-Fri or Mon-Thu,Sat");
  }

  if (config.SCHEDULED_START_HOUR !== undefined) {
    errors.push("Set WORK_START or SCHEDULED_START_HOUR, not both");
  }

  return errors;
}

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_HOURS = 5;
/** Second of the minute pulses fire at, clear of the reset boundary. */
const PULSE_SECOND = 10;
/** Working days searched ahead: enough to reach any day of the week. */
const SEARCH_DAYS = 8;

/** The given day at a clock time. */
function atClock(day, clock) {
  const d = new Date(day);
  d.setHours(clock.hour, clock.minute, 0, 0);
  return d;
}

/** Round up to the next full hour, unless already on one. */
function ceilToHour(date) {
  const d = new Date(date);
  if (d.getMinutes() || d.getSeconds() || d.getMilliseconds()) {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }
  return d;
}

/**
 * Build the work-hours rules.
 * @param {{start: {hour: number, minute: number}, end: {hour: number, minute: number}, hoursLeft: number, days: Set<number>}} settings
 * @returns {{nextAllowed: (t: Date) => Date, isActive: (t: Date) => boolean}}
 */
export function createWorkHours({ start, end, hoursLeft, days }) {
  /**
   * First pulse of a working day, so hoursLeft hours remain at start. It
   * never fires after the start of work's hour: rounding the target reset up
   * would otherwise push it past a start such as 09:30 with 5 hours left.
   */
  function dayStartPulse(workDay) {
    const targetReset = ceilToHour(
      new Date(atClock(workDay, start).getTime() + hoursLeft * HOUR_MS),
    );
    const pulse = new Date(targetReset);
    pulse.setHours(pulse.getHours() - WINDOW_HOURS, 0, PULSE_SECOND, 0);

    const latest = atClock(workDay, { hour: start.hour, minute: 0 });
    latest.setSeconds(PULSE_SECOND);
    return pulse < latest ? pulse : latest;
  }

  /**
   * The earliest time at or after t inside an active period.
   * @param {Date} t
   * @returns {Date}
   */
  function nextAllowed(t) {
    for (let offset = -1; offset <= SEARCH_DAYS; offset++) {
      const workDay = new Date(t);
      workDay.setHours(12, 0, 0, 0);
      workDay.setDate(workDay.getDate() + offset);
      if (!days.has(workDay.getDay())) continue;

      const periodStart = dayStartPulse(workDay);
      const periodEnd = atClock(workDay, end);
      if (t < periodEnd) {
        return t >= periodStart ? new Date(t) : periodStart;
      }
    }
    throw new Error("No working day found in WORK_DAYS");
  }

  return {
    nextAllowed,
    isActive: (t) => nextAllowed(t).getTime() === t.getTime(),
  };
}

/**
 * Build the work-hours rules from validated configuration.
 * @param {Object} config - Configuration that passed workHoursErrors()
 * @returns {ReturnType<typeof createWorkHours>|null} Null when WORK_START is unset
 */
export function createWorkHoursFromConfig(config) {
  if (config.WORK_START === undefined) {
    return null;
  }
  return createWorkHours({
    start: parseClock(config.WORK_START),
    end: parseClock(config.WORK_END),
    hoursLeft: Number(config.HOURS_LEFT_AT_START ?? WINDOW_HOURS),
    days: parseWorkDays(config.WORK_DAYS ?? "Mon-Sun"),
  });
}
