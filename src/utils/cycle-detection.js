import logger from "./logger.js";

/**
 * Session Block based cycle detection for Claude 5-hour limits
 * - Groups historical messages into 5-hour blocks
 * - Block start = first message after previous block expired, rounded down to hour
 * - Provides optional self-correction via explicit reset signals
 */
export class CycleDetector {
  constructor({ timezoneHandler } = {}) {
    this.logger = logger.child({ component: "cycle-detector" });
    this.timezoneHandler = timezoneHandler;

    // Self-correction state
    this.explicitNextCycleStartAt = null; // Date when next cycle starts (from parsed API message)
    this.pendingLimitSignal = false; // Generic signal that the next message will start a new cycle
  }

  roundDownToHour(date) {
    const d = new Date(date);
    d.setUTCMinutes(0, 0, 0);
    return d;
  }

  buildBlocks(messages = []) {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    // Sort by time ascending
    const sorted = messages
      .map((m) => ({ ...m, t: new Date(m.timestamp) }))
      .filter((m) => !isNaN(m.t.getTime()))
      .sort((a, b) => a.t - b.t);

    const blocks = [];
    let current = null;

    for (const m of sorted) {
      if (!current) {
        const start = this.roundDownToHour(m.t);
        current = {
          startTime: start,
          endTime: new Date(start.getTime() + 5 * 60 * 60 * 1000),
          firstMessageAt: m.t,
          lastMessageAt: m.t,
          messageCount: 1,
        };
        continue;
      }

      if (m.t <= current.endTime) {
        current.lastMessageAt = m.t;
        current.messageCount += 1;
      } else {
        blocks.push(current);
        const start = this.roundDownToHour(m.t);
        current = {
          startTime: start,
          endTime: new Date(start.getTime() + 5 * 60 * 60 * 1000),
          firstMessageAt: m.t,
          lastMessageAt: m.t,
          messageCount: 1,
        };
      }
    }

    if (current) blocks.push(current);
    return blocks;
  }

  findCurrentBlock(blocks, now = new Date()) {
    if (!blocks || blocks.length === 0) return null;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (now >= b.startTime && now <= b.endTime) return b;
      if (now > b.endTime) return null; // past the most recent block and no new message yet => not in a cycle
    }
    return null;
  }

  getTimeToReset(block, now = new Date()) {
    if (!block) return null;
    const diff = block.endTime.getTime() - now.getTime();
    return {
      totalMs: diff,
      hours: Math.max(0, Math.floor(diff / (60 * 60 * 1000))),
      minutes: Math.max(0, Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000))),
      isExpired: diff <= 0,
    };
  }

  // Self-correction inputs
  registerGenericLimitSignal() {
    this.pendingLimitSignal = true;
    this.logger.debug("signal", "Generic rate limit signal registered - next message starts new cycle");
  }

  registerExplicitResetTime(date) {
    if (!date || isNaN(new Date(date).getTime())) return;
    this.explicitNextCycleStartAt = new Date(date);
    this.logger.info("signal", "Explicit reset time registered", {
      resetAt: this.explicitNextCycleStartAt.toISOString(),
    });
  }

  clearSignals() {
    this.pendingLimitSignal = false;
    this.explicitNextCycleStartAt = null;
  }

  getSignals() {
    return {
      pendingLimitSignal: this.pendingLimitSignal,
      explicitNextCycleStartAt: this.explicitNextCycleStartAt,
    };
  }
}

export default CycleDetector;
