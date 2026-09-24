/**
 * The version to report: the one the image was built as, when there is one.
 * Snapshot and edge images carry package.json's last released version, so
 * without this every build would report the same number.
 * @param {Object} env - Process environment
 * @param {string} packageVersion - Version from package.json
 * @returns {string}
 */
export function resolveAppVersion(env, packageVersion) {
  const built = env.CLAUDEPULSE_VERSION;
  return built && built !== "unknown" ? built : packageVersion;
}
