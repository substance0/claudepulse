# ClaudePulse - Automated Claude Code session renewal with intelligent pulse scheduling for maximum Pro/Max subscription value
# Node.js scheduler that runs the Claude Code CLI for each pulse

FROM node:25-alpine

# tini forwards signals to the scheduler and reaps pulse subprocesses
RUN apk add --no-cache tini

# The Claude Code CLI that pulses run, at the version pinned in
# docker/claude-cli/package-lock.json
WORKDIR /opt/claude-cli
COPY docker/claude-cli/package.json docker/claude-cli/package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit && \
    npm cache clean --force
ENV PATH="/opt/claude-cli/node_modules/.bin:$PATH"
RUN claude --version

# Create app directory and non-root user
RUN addgroup -g 1001 -S claudepulse && \
    adduser -S -D -u 1001 -G claudepulse claudepulse

# Set working directory
WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install application dependencies (this layer caches well)
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application source code LAST (invalidates cache on code changes)
COPY src/ ./src/

# Build arguments for version information (placed after expensive layers for better caching)
ARG VERSION=unknown
ARG BUILD_DATE=unknown
ARG VCS_REF=unknown

# Reported at startup, so a running container identifies its build
ENV CLAUDEPULSE_VERSION=${VERSION}

# Set proper ownership and permissions
RUN chown -R claudepulse:claudepulse /app && \
    chmod +x src/index.js

# Switch to non-root user
USER claudepulse

# Create the Claude Code home directory with restrictive permissions
RUN mkdir -p /home/claudepulse/.claude && \
    chmod 700 /home/claudepulse/.claude

# Environment variables with defaults
ENV NODE_ENV=production \
    PROMPT_TEXT="pulse check" \
    MAX_RETRIES=3 \
    RETRY_BACKOFF_MULTIPLIER=2 \
    MAX_BACKOFF_MINUTES=30 \
    LOG_LEVEL=INFO \
    LOG_FORMAT=inline \
    DRY_RUN=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Health check that verifies Node.js and the Claude CLI are available
HEALTHCHECK --interval=5m --timeout=30s --start-period=30s --retries=3 \
    CMD node -e "console.log('Node.js OK')" && claude --version > /dev/null || exit 1

# Explicit stop signal for graceful shutdown
STOPSIGNAL SIGTERM

# Use tini as entrypoint for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the automation application
# Override with /bin/sh for debugging: docker run -it claudepulse /bin/sh
CMD ["node", "src/index.js"]

# Labels for metadata
LABEL maintainer="ClaudePulse Project" \
      description="Automated Claude Code session renewal with intelligent pulse scheduling for maximum Pro/Max subscription value" \
      version="${VERSION}" \
      org.opencontainers.image.title="ClaudePulse" \
      org.opencontainers.image.description="Automated Claude Code session renewal with intelligent pulse scheduling for maximum Pro/Max subscription value" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.source="https://github.com/substance0/claudepulse" \
      org.opencontainers.image.url="https://github.com/substance0/claudepulse" \
      org.opencontainers.image.documentation="https://github.com/substance0/claudepulse#readme" \
      org.opencontainers.image.vendor="ClaudePulse Project"