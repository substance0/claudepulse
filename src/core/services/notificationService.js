/**
 * Discord Notification Service
 * Sends rich embed notifications to Discord via webhooks
 */

/**
 * Discord embed color codes for different severity levels
 */
const EMBED_COLORS = {
  ERROR: 0xed4245, // Red
  WARN: 0xfaa61a, // Orange
  INFO: 0x5865f2, // Blue
  SUCCESS: 0x57f287, // Green
};

/**
 * Sends a Discord notification with rich embed formatting
 * @param {Object} payload - Notification payload
 * @param {string} payload.title - Embed title
 * @param {string} payload.description - Embed description
 * @param {string} payload.level - Alert level (ERROR, WARN, INFO, SUCCESS)
 * @param {Array<{name: string, value: string, inline?: boolean}>} payload.fields - Embed fields
 * @param {string} payload.timestamp - ISO timestamp
 * @param {string} webhookUrl - Discord webhook URL
 * @returns {Promise<void>}
 */
export async function sendDiscordAlert(payload, webhookUrl) {
  if (!webhookUrl) {
    // Silently skip if no webhook configured
    return;
  }

  const {
    title,
    description,
    level = "INFO",
    fields = [],
    timestamp,
  } = payload;

  const embed = {
    title,
    description,
    color: EMBED_COLORS[level] || EMBED_COLORS.INFO,
    fields,
    timestamp: timestamp || new Date().toISOString(),
    footer: {
      text: "ClaudePulse",
    },
  };

  const discordPayload = {
    embeds: [embed],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(discordPayload),
    });

    if (!response.ok) {
      // Don't throw - gracefully handle webhook failures
      console.error(
        `Discord webhook failed: ${response.status} ${response.statusText}`,
      );
    }
  } catch (error) {
    // Gracefully handle network errors
    console.error(`Failed to send Discord notification: ${error.message}`);
  }
}

export default {
  sendDiscordAlert,
  EMBED_COLORS,
};
