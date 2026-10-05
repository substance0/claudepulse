# [2.7.0](https://github.com/substance0/claudepulse/compare/v2.6.0...v2.7.0) (2026-10-05)


### Bug Fixes

* keep the webhook URL out of Discord delivery failure logs ([f92d309](https://github.com/substance0/claudepulse/commit/f92d3095c89c3177c476b2b12917bceae81af1a8))
* name the notifier when Discord refuses a post ([633aa08](https://github.com/substance0/claudepulse/commit/633aa087d0dfe11580eb6b825bcb3d00c9b5daa2))
* post extra usage once when both webhooks are the same URL ([fb6fa4e](https://github.com/substance0/claudepulse/commit/fb6fa4e8c4b95e0d41edc77a534b9c7101cfc7c4))
* stop promising one credit pulse per blocked period ([95518ef](https://github.com/substance0/claudepulse/commit/95518ef9f9d574d9fb515ea35071ac351eb57e47))


### Features

* alert on the errors webhook when a pulse ran on paid extra usage ([e90eeb3](https://github.com/substance0/claudepulse/commit/e90eeb3fed738c53a8bb56b6ec003ceead34aad4))
* rename the errors webhook setting to DISCORD_ERROR_WEBHOOK_URL ([a1abdae](https://github.com/substance0/claudepulse/commit/a1abdaedebe3fa5a46f8ad3dabf366f62cbeded2))

# [2.6.0](https://github.com/substance0/claudepulse/compare/v2.5.0...v2.6.0) (2026-10-04)


### Bug Fixes

* give each state save a temporary file of its own ([0acd9a8](https://github.com/substance0/claudepulse/commit/0acd9a8e73a5cf157c9fff3882351a45a5e2e599))
* make a dry run report the saved schedule a real start would resume ([0741846](https://github.com/substance0/claudepulse/commit/07418460cbceb11588e6d7a8d4635c89a447fd5a))
* never let a hung state write stop the next pulse being scheduled ([241ac3c](https://github.com/substance0/claudepulse/commit/241ac3cee5cbd18b6e8fedc4ecdc7b91b1fc2fe8))
* refuse a saved pulse time beyond any real schedule and pin that it is used once ([a962bd7](https://github.com/substance0/claudepulse/commit/a962bd781216fc7368a1f339583429d363b8c060))
* resume a saved schedule only under the same settings and a known window ([c2d87d5](https://github.com/substance0/claudepulse/commit/c2d87d5b52cf925dd5c9bf32e65fc3675ac1cd39))
* validate the saved rate limit's shape and name the state file in load errors ([ff9aa0f](https://github.com/substance0/claudepulse/commit/ff9aa0f47860f13ac30ff01eaa2f691ae8762140))


### Features

* enable the state file with STATE_DIR ([6038c64](https://github.com/substance0/claudepulse/commit/6038c645f708ab4fbe1387f1efd7696e7e00752a))
* resume the planned pulse after a restart ([bfa7b1b](https://github.com/substance0/claudepulse/commit/bfa7b1b53e77f881f5adc48e1f706271fcd496ed))
* store the next planned pulse in a state file ([cf0b299](https://github.com/substance0/claudepulse/commit/cf0b299e1a324efff77504140a7f2256722a9d5c))

# [2.5.0](https://github.com/substance0/claudepulse/compare/v2.4.0...v2.5.0) (2026-10-04)


### Features

* keep rate-limit fields the executor does not understand ([71ad645](https://github.com/substance0/claudepulse/commit/71ad64587cc5040f7dd016ded0569204139f639d))
* log unrecognised rate-limit fields once ([b1a7a68](https://github.com/substance0/claudepulse/commit/b1a7a688fc0b58eadf1eee10dab989cb03db8932))
* read extra-usage state from each pulse's rate limit ([dd6e67d](https://github.com/substance0/claudepulse/commit/dd6e67db30af69110b43a1fd64b0d9c068c912d7))
* show extra usage in the pulse log and keep billing values out of the probe ([a2c18a2](https://github.com/substance0/claudepulse/commit/a2c18a29208fc0e045beb04f4e9c41e17ed6823e))

# [2.4.0](https://github.com/substance0/claudepulse/compare/v2.3.0...v2.4.0) (2026-10-03)


### Bug Fixes

* check the token expiry before the first pulse ([6773851](https://github.com/substance0/claudepulse/commit/6773851dd987103c463dfae0e2e4cfe1a66dee0a))
* count token expiry days in calendar days ([b114ce0](https://github.com/substance0/claudepulse/commit/b114ce0b652e16803b0656961e9d6e48a06feb19))
* log token warnings once labelled and with the local expiry date ([b63ea7f](https://github.com/substance0/claudepulse/commit/b63ea7fa77347933659a37e32802a4736b5ea7d6))
* retry a token expiry warning Discord did not accept ([1444845](https://github.com/substance0/claudepulse/commit/1444845c13f22eb4f2321dde923d259fd7c4e395))
* trim spaces around TOKEN_EXPIRES_AT ([8da7430](https://github.com/substance0/claudepulse/commit/8da7430187b886bb76f539b97ea317b2fa3c1762))


### Features

* compute token expiry warnings ([5cbba07](https://github.com/substance0/claudepulse/commit/5cbba0714032fea09cc0ec0f6726d2fa054fe22f))
* tell the operator how to renew a rejected token ([185530b](https://github.com/substance0/claudepulse/commit/185530b8f1b079ac919c14abdea6bf7d6d447483))
* warn before the Claude token expires ([d750c9b](https://github.com/substance0/claudepulse/commit/d750c9ba9255908fa6e47eee7d00351f97d16b96))

# [2.3.0](https://github.com/substance0/claudepulse/compare/v2.2.0...v2.3.0) (2026-09-28)


### Bug Fixes

* let a reported limit type decide whether the weekly limit blocks pulsing ([18575de](https://github.com/substance0/claudepulse/commit/18575ded15cc7e674a366c91bf6bcddd22351a96))
* never announce the weekly reset as the current window's reset ([f18084a](https://github.com/substance0/claudepulse/commit/f18084ab92f1caf23b0ee91efcb2b4f8dfb3e415))


### Features

* announce the weekly limit and show weekly usage ([aac074b](https://github.com/substance0/claudepulse/commit/aac074be89bb8a0feba6132590cf7fec9af3fe22))
* log weekly usage with each successful pulse ([b110657](https://github.com/substance0/claudepulse/commit/b11065713150846f09af111537ef85d1182bc3fb))
* name the weekly or 5-hour limit in the refusal log line ([a55f2a7](https://github.com/substance0/claudepulse/commit/a55f2a75f8d6c53c9241414f78468ed20e18e9e1))
* read the weekly window from each pulse ([bdc1f22](https://github.com/substance0/claudepulse/commit/bdc1f22e6edf8c09342091a0c5b29b16270454a1))

# [2.2.0](https://github.com/substance0/claudepulse/compare/v2.1.0...v2.2.0) (2026-09-28)


### Bug Fixes

* never open the working day after work starts ([9031a94](https://github.com/substance0/claudepulse/commit/9031a9484a9519deedbc7c00b95e05d0d2b1f33a))
* place the day-start pulse exactly 5 real hours before the target reset ([79285f6](https://github.com/substance0/claudepulse/commit/79285f6a103db8516d66ce6d5698a602b5cb22b6))
* reject day ranges with more than one dash in WORK_DAYS ([4d4e4c5](https://github.com/substance0/claudepulse/commit/4d4e4c5c87e40b49589bfaa3d8901b9a02da147a))
* stop retrying a failed pulse once work hours are over ([ebad948](https://github.com/substance0/claudepulse/commit/ebad948cb6b3c12d139ca8c5ddc8fade3cf1af01))


### Features

* compute the day-start pulse and the next allowed pulse time ([e4accac](https://github.com/substance0/claudepulse/commit/e4accac4ef4cabba49f92a3f8d7d85d0b5366c75))
* load and validate the work-hours settings ([1aa6758](https://github.com/substance0/claudepulse/commit/1aa6758097144f9eaa8f52b3661a6979d967a879))
* log when work hours move a pulse and when the working day starts ([d8f36ce](https://github.com/substance0/claudepulse/commit/d8f36ce1fdcc9a973ab3d663f3d16ef3b3e5f340))
* parse and validate work-hours settings ([cdbffef](https://github.com/substance0/claudepulse/commit/cdbffef2cb3e1a43ca21bfc81d1afbd92573f906))
* pulse only during work hours and open the working day early ([b8e01b6](https://github.com/substance0/claudepulse/commit/b8e01b6a3d6581dada61704adfac41186cb2c914))
* switch work hours on only with WORK_HOURS_ENABLED=true ([e8c6aa7](https://github.com/substance0/claudepulse/commit/e8c6aa7646db5cb004ce670b76e0737876584931))
* warn about work hours that are ignored or leave too little time off ([088705f](https://github.com/substance0/claudepulse/commit/088705f39b8c1c60bbbee9e9e365ef7cbdad78b4))

# [2.1.0](https://github.com/substance0/claudepulse/compare/v2.0.0...v2.1.0) (2026-09-27)


### Bug Fixes

* label the shutdown log line with the account ([ea9549c](https://github.com/substance0/claudepulse/commit/ea9549c5e3e53515d07279233f36a19216f3fbc8))
* trim spaces around ACCOUNT_LABEL ([8559c69](https://github.com/substance0/claudepulse/commit/8559c69c677959c7fd7eae8edb24876f81c571e4))


### Features

* label window notifications with the account ([83ba0af](https://github.com/substance0/claudepulse/commit/83ba0af190f0c2595fefcb8dcc1b7d8270757857))
* read and validate an optional ACCOUNT_LABEL ([d693846](https://github.com/substance0/claudepulse/commit/d693846967ad5a423848c418e2bf3fbe51757c74))
* show the account label in log lines and error alerts ([9a1f536](https://github.com/substance0/claudepulse/commit/9a1f536e75578855c8672b4f8d36f5cb3936e8ce))

# [2.0.0](https://github.com/substance0/claudepulse/compare/v1.0.0...v2.0.0) (2026-09-24)


* feat!: authenticate pulses with a Claude Code token ([5caac39](https://github.com/substance0/claudepulse/commit/5caac39ab19dd859e1d6c28bfb9df11e74881300))


### Bug Fixes

* pin the config directory for pulse subprocesses ([0dc1c0d](https://github.com/substance0/claudepulse/commit/0dc1c0dae8575e85e7f456002c03f40ad0078fd9))
* propagate Discord webhook URL to child loggers ([f30892c](https://github.com/substance0/claudepulse/commit/f30892c3aec9ccb80c8364156eb70ee4c7b3da86))
* show pulse errors and window resets in inline logs ([d740114](https://github.com/substance0/claudepulse/commit/d74011414acfc0c8bec7c54550392a0f95dc481f))
* stop overriding the image healthcheck with a no-op ([14c9d93](https://github.com/substance0/claudepulse/commit/14c9d93032a1020f23558a9ac0f601c4b5c08962))
* stop retrying auth failures and space out repeated alerts ([72d985c](https://github.com/substance0/claudepulse/commit/72d985cb220da86ec8eaea408a6e5c522590f6d2))


### Features

* add ClaudeCliExecutor argument builder for cheap pulses ([21b90fc](https://github.com/substance0/claudepulse/commit/21b90fce2de1412dd1dc544797e2e3ec689f7b48))
* announce window reset times on a dedicated Discord webhook ([8cb5ddb](https://github.com/substance0/claudepulse/commit/8cb5ddbdeb90dea0c109eeae89f00d2b30dca1eb))
* drive scheduling from the pulse's rate-limit window ([4c0239e](https://github.com/substance0/claudepulse/commit/4c0239e97772d61be8213be6eddafc037ce752cb))
* mask secrets in the startup configuration log ([f61fc76](https://github.com/substance0/claudepulse/commit/f61fc768ceb2bb13777bc1aeae7ab83a932876b1))
* parse Claude CLI pulse results and classify auth failures ([fc27246](https://github.com/substance0/claudepulse/commit/fc27246121822f9ef61e875a04b3db882a766ab8))
* read the rate-limit window from each pulse ([04a9277](https://github.com/substance0/claudepulse/commit/04a9277f7fe16e809e7db69c71dbcb00afafada8))
* report the version the image was built as ([ed280f0](https://github.com/substance0/claudepulse/commit/ed280f033c50aa1da4e766da5512eb9057cd40d1))
* run pulses as a Claude Code subprocess ([f645818](https://github.com/substance0/claudepulse/commit/f6458184e9d8564a3863f986a05dd5dbc86b1cd9))
* schedule pulses through the Claude CLI executor ([46a21d2](https://github.com/substance0/claudepulse/commit/46a21d2e1c5390548470394720935fee086d9b39))
* schedule the next pulse from the reported window reset ([b7295f4](https://github.com/substance0/claudepulse/commit/b7295f44062d3d3d88bea6c265c5b1a6707cb7a9))


### BREAKING CHANGES

* the in-container OAuth login flow (the authorization URL
in the logs and `npm run oauth-verify`) is removed, and credentials are no
longer read from the claudepulse-data volume. Before upgrading, run
`claude setup-token` on a machine with a browser and pass the token as
CLAUDE_CODE_OAUTH_TOKEN, preferably through an env_file. The volume can
then be removed.

# 1.0.0 (2025-10-15)


### Features

* ClaudePulse v1.0.0 - Production-ready automated Claude session manager ([5f67d29](https://github.com/substance0/claudepulse/commit/5f67d297adeb87378b8084498febd7e4b6ef03e4))


### BREAKING CHANGES

* Complete v1.0.0 release with comprehensive features

This release includes the complete ClaudePulse system with:

Core Features:
- Automated Claude session management and cycling
- Secure authentication with credential storage
- Multi-strategy scheduling (CRON, immediate, smart-timing, off-peak)
- Session tracking and analytics
- Project-level log aggregation
- Rate limit handling and retry logic
- Desktop notifications for session events
- Docker containerization with health checks

Technical Implementation:
- Modular architecture with clear separation of concerns
- Comprehensive error handling and logging
- State management and token refresh
- SDK-based Claude integration
- Configurable scheduling strategies
- Session limit parsing and enforcement
- Timezone-aware scheduling
- Health monitoring and status reporting

Infrastructure:
- GitHub Actions CI/CD pipelines
- Automated semantic versioning
- Docker Hub publishing
- Development and production Docker Compose setups
- Comprehensive documentation

Documentation:
- Complete README with setup instructions
- Contributing guidelines
- Environment configuration guide
- Workflow diagrams
- Task Master integration

This represents the stable v1.0.0 release ready for production use.

## [1.1.3](https://github.com/substance0/claudepulse/compare/v1.1.2...v1.1.3) (2025-10-14)


### Bug Fixes

* **session:** include activeSessions in early return when no data directory found ([26246ff](https://github.com/substance0/claudepulse/commit/26246ff17f9912314cabe4a41ac1b121796c40f8))

## [1.1.2](https://github.com/substance0/claudepulse/compare/v1.1.1...v1.1.2) (2025-10-14)


### Bug Fixes

* **scheduler:** eliminate duplicate strategy evaluation on startup ([a42e5aa](https://github.com/substance0/claudepulse/commit/a42e5aaa5485835fe7ab25f93d36ab42c8d1e96c))

## [1.1.1](https://github.com/substance0/claudepulse/compare/v1.1.0...v1.1.1) (2025-10-14)


### Bug Fixes

* **ci:** configure git authentication for develop branch sync ([7b32c5f](https://github.com/substance0/claudepulse/commit/7b32c5f31d72ee1e70a58bdea46521c276a7555f))

# [1.1.0](https://github.com/substance0/claudepulse/compare/v1.0.0...v1.1.0) (2025-10-14)


### Bug Fixes

* **session): include activeSessions count in logs; feat(ci:** auto-sync releases to develop ([95c2d2a](https://github.com/substance0/claudepulse/commit/95c2d2a061d1956bb235334dea048081cdc2b5fe))


### Features

* **ui:** add ASCII banner with project information ([9ab8be8](https://github.com/substance0/claudepulse/commit/9ab8be8c4b896c117e011fee7b6ae1ca3e55afec))

# 1.0.0 (2025-10-14)

### Features

- ClaudePulse v1.0.0 - Complete automated session management system ([f211b5c](https://github.com/substance0/claudepulse/commit/f211b5c97340dabc0b8e13638158e4d21d613e45))

# [1.1.0](https://github.com/substance0/claudepulse/compare/v1.0.1...v1.1.0) (2025-10-14)

### Features

- **docker:** add version labels to container images ([ca5066c](https://github.com/substance0/claudepulse/commit/ca5066c85cc703ebb35fe13d2e8f63405a9ed71b))

## [1.0.1](https://github.com/substance0/claudepulse/compare/v1.0.0...v1.0.1) (2025-10-14)

### Bug Fixes

- **scheduler:** prevent double-scheduling when session limit detected ([c44905a](https://github.com/substance0/claudepulse/commit/c44905a708ecb8ba34de1c1c8d50f9b70b5c0e15))

# 1.0.0 (2025-10-14)

### Features

- ClaudePulse v1.0.0 - Automated Claude Pro/Max Session Management ([b959d6d](https://github.com/substance0/claudepulse/commit/b959d6dae91ea7f7a3d4ad16762d644d65c120bb))

### BREAKING CHANGES

- Initial v1.0.0 release

# 1.0.0 (2025-10-12)

### Features

- initial v1.0.0 release of ClaudePulse ([0c07df0](https://github.com/substance0/claudepulse/commit/0c07df0db7ea6b5b44f0ae7acd7c8cf3462b2b24))

### BREAKING CHANGES

- Initial v1.0.0 release

# 1.0.0 (2025-10-12)

### Features

- initial v1.0.0 release of ClaudePulse ([26064eb](https://github.com/substance0/claudepulse/commit/26064ebf92294d4cb6b82e9a4e314c98c165850e))

### BREAKING CHANGES

- Initial v1.0.0 release
