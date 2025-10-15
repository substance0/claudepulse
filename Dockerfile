# ClaudePulse - Automated Claude Session Renewal Container
# Node.js application with OAuth authentication and Claude CLI integration

FROM node:20-alpine

# Install runtime dependencies including Claude CLI
RUN apk add --no-cache \
    bash \
    curl \
    tini \
    && npm install -g @anthropic-ai/claude-code \
    && claude --version

# Create app directory and non-root user
RUN addgroup -g 1001 -S claudeapp && \
    adduser -S -D -u 1001 -s /bin/bash -G claudeapp claudeapp

# Set working directory
WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install application dependencies (this layer caches well)
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application source code LAST (invalidates cache on code changes)
COPY src/ ./src/

# Set proper ownership and permissions
RUN chown -R claudeapp:claudeapp /app && \
    chmod +x src/index.js

# Switch to non-root user
USER claudeapp

# Create .claude directory for credentials with proper permissions
RUN mkdir -p /home/claudeapp/.claude && \
    chmod 700 /home/claudeapp/.claude

# Environment variables with defaults
ENV NODE_ENV=production \
    PROMPT_TEXT="pulse check" \
    MAX_RETRIES=3 \
    RETRY_BACKOFF_MULTIPLIER=2 \
    MAX_BACKOFF_MINUTES=30 \
    LOG_LEVEL=INFO \
    LOG_FORMAT=inline \
    DRY_RUN=false

# Health check that verifies both Node.js app and Claude CLI
HEALTHCHECK --interval=5m --timeout=30s --start-period=30s --retries=3 \
    CMD node -e "console.log('Node.js OK')" && claude --version || exit 1

# Explicit stop signal for graceful shutdown
STOPSIGNAL SIGTERM

# Use tini as entrypoint for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the automation application
# Override with /bin/sh for debugging: docker run -it claudepulse /bin/sh
CMD ["node", "src/index.js"]

# Labels for metadata
LABEL maintainer="ClaudePulse Project" \
      description="Automated Claude session management with intelligent pulse scheduling" \
      version="1.0.0" \
      org.opencontainers.image.title="ClaudePulse" \
      org.opencontainers.image.description="Automated Claude session management container" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.source="https://github.com/claudepulse/claudepulse"