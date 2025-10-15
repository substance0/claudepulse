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
