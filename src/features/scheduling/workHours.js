/**
 * Work hours: when pulses are allowed, and when the first window of a working
 * day opens.
 *
 * A window ends at its first prompt's hour, rounded down, plus 5 hours. To
 * have HOURS_LEFT_AT_START hours left when work starts, the day's first pulse
 * fires 5 hours before WORK_START + HOURS_LEFT_AT_START, rounded up to the
 * hour. All times are local to the container's TZ.
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
