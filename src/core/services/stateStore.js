/**
 * State Store
 * Keeps the next planned pulse and the last rate-limit state in a JSON file,
 * so a restarted container resumes its schedule.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const STATE_VERSION = 1;
const STATE_FILE = "state.json";

/** ISO string for a Date, or null. */
function toIso(date) {
  return date instanceof Date ? date.toISOString() : null;
}

/** Date from an ISO string, or null when absent or invalid. */
function fromIso(text) {
  if (typeof text !== "string") return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The part of a rate-limit state that scheduling and the weekly-limit
 * messages read; the rest is learned again from the next pulse.
 */
function serialiseRateLimit(rateLimit) {
  if (!rateLimit) return null;
  return {
    status: rateLimit.status,
    resetsAt: toIso(rateLimit.resetsAt),
    fiveHourResetsAt: toIso(rateLimit.fiveHourResetsAt),
    limitType: rateLimit.limitType ?? null,
    weekly: rateLimit.weekly
      ? {
          utilization: rateLimit.weekly.utilization,
          resetsAt: toIso(rateLimit.weekly.resetsAt),
        }
      : null,
  };
}

function reviveRateLimit(data) {
  if (!data) return null;
  return {
    status: data.status,
    resetsAt: fromIso(data.resetsAt),
    fiveHourResetsAt: fromIso(data.fiveHourResetsAt),
    limitType: data.limitType ?? null,
    weekly: data.weekly
      ? {
          utilization: data.weekly.utilization,
          resetsAt: fromIso(data.weekly.resetsAt),
        }
      : null,
  };
}

/**
 * Create a store for the state file in dir.
 * @param {string} dir - Directory holding state.json
 * @returns {{load: Function, save: Function}}
 */
export function createStateStore(dir) {
  const file = path.join(dir, STATE_FILE);

  return {
    /**
     * @returns {Promise<{nextPulseAt: Date, rateLimit: Object|null}|null>}
     *   Null when nothing was saved yet
     * @throws {Error} When the file cannot be read or understood
     */
    async load() {
      let text;
      try {
        text = await fs.readFile(file, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }

      const data = JSON.parse(text);
      if (data?.version !== STATE_VERSION) {
        throw new Error(`Unsupported state version: ${data?.version}`);
      }
      const nextPulseAt = fromIso(data.nextPulseAt);
      if (!nextPulseAt) {
        throw new Error("State has no valid nextPulseAt");
      }
      return { nextPulseAt, rateLimit: reviveRateLimit(data.rateLimit) };
    },

    /**
     * Write the state atomically: a crash mid-write leaves the previous file.
     * @param {{nextPulseAt: Date, rateLimit: Object|null}} state
     */
    async save({ nextPulseAt, rateLimit }) {
      await fs.mkdir(dir, { recursive: true });
      // A name of its own per save, so concurrent saves into one directory
      // never write or rename the same temporary file.
      const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      const body = {
        version: STATE_VERSION,
        nextPulseAt: toIso(nextPulseAt),
        rateLimit: serialiseRateLimit(rateLimit),
        savedAt: new Date().toISOString(),
      };
      try {
        await fs.writeFile(temp, JSON.stringify(body, null, 2));
        await fs.rename(temp, file);
      } catch (error) {
        await fs.rm(temp, { force: true });
        throw error;
      }
    },
  };
}
