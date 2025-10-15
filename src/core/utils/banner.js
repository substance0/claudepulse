/**
 * ASCII Banner for ClaudePulse
 * Displays project information on startup
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get package.json data
 */
function getPackageInfo() {
  try {
    const packagePath = join(__dirname, "../../../package.json");
    const packageData = JSON.parse(readFileSync(packagePath, "utf8"));
    return {
      version: packageData.version,
      description: packageData.description,
      homepage: packageData.homepage,
      license: packageData.license,
    };
  } catch (error) {
    return {
      version: "unknown",
      description: "Automated Claude Code session renewal",
      homepage: "https://github.com/substance0/claudepulse",
      license: "MIT",
    };
  }
}

/**
 * Generate ASCII banner with project information
 */
export function generateBanner() {
  const pkg = getPackageInfo();
  const year = new Date().getFullYear();

  // Color codes (will be stripped in non-TTY environments)
  const cyan = process.stdout.isTTY ? "\x1b[36m" : "";
  const green = process.stdout.isTTY ? "\x1b[32m" : "";
  const yellow = process.stdout.isTTY ? "\x1b[33m" : "";
  const dim = process.stdout.isTTY ? "\x1b[90m" : "";
  const reset = process.stdout.isTTY ? "\x1b[0m" : "";
  const bold = process.stdout.isTTY ? "\x1b[1m" : "";

  return `
${cyan}╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║              ${bold}██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗${reset}${cyan}             ║
║             ${bold}██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝${reset}${cyan}             ║
║             ${bold}██║     ██║     ███████║██║   ██║██║  ██║█████╗${reset}${cyan}               ║
║             ${bold}██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝${reset}${cyan}               ║
║             ${bold}╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗${reset}${cyan}             ║
║              ${bold}╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝${reset}${cyan}             ║
║                                                                           ║
║                  ${bold}██████╗ ██╗   ██╗██╗     ███████╗███████╗${reset}${cyan}                ║
║                  ${bold}██╔══██╗██║   ██║██║     ██╔════╝██╔════╝${reset}${cyan}                ║
║                  ${bold}██████╔╝██║   ██║██║     ███████╗█████╗${reset}${cyan}                  ║
║                  ${bold}██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝${reset}${cyan}                  ║
║                  ${bold}██║     ╚██████╔╝███████╗███████║███████╗${reset}${cyan}                ║
║                  ${bold}╚═╝      ╚═════╝ ╚══════╝╚══════╝╚══════╝${reset}${cyan}                ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝${reset}

  ${green}${bold}Automated Claude Pro/Max Session Management${reset}
  ${dim}Maintain steady pulse on Claude Pro/Max sessions for maximum coding availability${reset}

  ${yellow}Version:${reset}       ${bold}${pkg.version}${reset}
  ${yellow}License:${reset}       ${bold}${pkg.license}${reset}
  ${yellow}Repository:${reset}    ${bold}${pkg.homepage}${reset}
`;
}

/**
 * Display banner to console
 */
export function displayBanner() {
  console.log(generateBanner());
}

export default { generateBanner, displayBanner };
