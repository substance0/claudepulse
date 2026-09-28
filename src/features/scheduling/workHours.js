/**
 * Work hours: when pulses are allowed, and when the first window of a working
 * day opens.
 *
 * A window resets 5 hours after the minute of the pulse that opens it. To have
 * HOURS_LEFT_AT_START hours left when work starts, the day's first pulse
 * fires 5 hours before WORK_START + HOURS_LEFT_AT_START, plus a 10-second
 * buffer. Clock times are local to the container's TZ.
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
    const ends = part.toLowerCase().split("-").map((end) => end.trim());
    if (ends.length > 2) {
      return null;
    }
    const [from, to = from] = ends;
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
 * Validation errors for the work-hours settings. Work hours are opt-in: while
 * WORK_HOURS_ENABLED is not true, the other settings are ignored, so they can
 * stay in place while the feature is switched off.
 * @param {Object} config - Loaded configuration
 * @returns {string[]}
 */
export function workHoursErrors(config) {
  const errors = [];
  const { WORK_START, WORK_END, WORK_DAYS, HOURS_LEFT_AT_START } = config;

  if (config.WORK_HOURS_ENABLED !== true) {
    return errors;
  }

  if (WORK_START === undefined) {
    errors.push("WORK_HOURS_ENABLED=true requires WORK_START and WORK_END");
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

/**
 * Warnings about work-hours settings that are valid but likely not what the
 * operator wants. They never stop ClaudePulse.
 * @param {Object} config - Configuration that passed workHoursErrors()
 * @returns {string[]}
 */
export function workHoursWarnings(config) {
  const settingsPresent = ["WORK_START", "WORK_END", "WORK_DAYS", "HOURS_LEFT_AT_START"]
    .some((key) => config[key] !== undefined);

  if (config.WORK_HOURS_ENABLED !== true) {
    return settingsPresent
      ? ["Work-hours settings are set but WORK_HOURS_ENABLED is not true, so they are ignored"]
      : [];
  }

  const start = parseClock(config.WORK_START);
  const end = parseClock(config.WORK_END);
  if (!start || !end) {
    return [];
  }

  // A window opened just before WORK_END lasts 5 hours. If the next working
  // day's first pulse comes sooner, that window is still open and the morning
  // starts with fewer hours left than asked.
  const hoursLeft = Number(config.HOURS_LEFT_AT_START ?? WINDOW_HOURS);
  const nextStartMinutes =
    MINUTES_PER_DAY + start.hour * 60 + start.minute + (hoursLeft - WINDOW_HOURS) * 60;
  const offMinutes = nextStartMinutes - (end.hour * 60 + end.minute);
  if (offMinutes >= WINDOW_HOURS * 60) {
    return [];
  }

  return [
    `Work hours leave ${offMinutes} minutes between WORK_END (${config.WORK_END}) and the next day's first pulse, less than the 5 hours a window lasts: mornings may start with fewer than ${hoursLeft} ${hoursLeft === 1 ? "hour" : "hours"} left. Set WORK_END at least 5 hours before the first pulse, or turn work hours off with WORK_HOURS_ENABLED=false, since so little time off gains almost nothing.`,
  ];
}

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_HOURS = 5;
const MINUTES_PER_DAY = 24 * 60;
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

/**
 * Build the work-hours rules.
 * @param {{start: {hour: number, minute: number}, end: {hour: number, minute: number}, hoursLeft: number, days: Set<number>}} settings
 * @returns {{nextAllowed: (t: Date) => Date, isActive: (t: Date) => boolean}}
 */
export function createWorkHours({ start, end, hoursLeft, days }) {
  /**
   * First pulse of a working day, so hoursLeft hours remain at start. Windows
   * last 5 real hours, so the offset is real time, not wall-clock hours, which
   * keeps the hours left exact on daylight-saving days.
   */
  function dayStartPulse(workDay) {
    const targetReset =
      atClock(workDay, start).getTime() + hoursLeft * HOUR_MS;
    return new Date(targetReset - WINDOW_HOURS * HOUR_MS + PULSE_SECOND * 1000);
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
 * @returns {ReturnType<typeof createWorkHours>|null} Null unless WORK_HOURS_ENABLED is true
 */
export function createWorkHoursFromConfig(config) {
  if (config.WORK_HOURS_ENABLED !== true) {
    return null;
  }
  return createWorkHours({
    start: parseClock(config.WORK_START),
    end: parseClock(config.WORK_END),
    hoursLeft: Number(config.HOURS_LEFT_AT_START ?? WINDOW_HOURS),
    days: parseWorkDays(config.WORK_DAYS ?? "Mon-Sun"),
  });
}
