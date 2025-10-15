// Minimal date formatting utilities without external dependencies

/**
 * Format a Date (or date-like) as ISO 8601 with local timezone offset.
 * Example: 2025-09-26T14:00:00.000+02:00
 * @param {Date|string|number} dateInput - Date object, date string, or timestamp
 * @returns {string} Formatted date string in local ISO format
 */
export function formatLocalIso(dateInput) {
  const d = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput);
  if (isNaN(d.getTime())) return "Invalid Date";

  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  const millis = pad(d.getMilliseconds(), 3);

  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const om = pad(Math.abs(offsetMinutes) % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}${sign}${oh}:${om}`;
}

export default {
  formatLocalIso,
};
