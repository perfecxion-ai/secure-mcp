# Multi-stage production Dockerfile with security hardening
# Stage 1: Dependencies
FROM node:20.11.0-alpine3.19 AS dependencies
WORKDIR /build

# Install security updates and required packages
RUN apk update && \
    apk upgrade && \
    apk add --no-cache \
    dumb-init=1.2.5-r3 \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies with exact versions
RUN npm ci --only=production --ignore-scripts && \
    npx prisma generate && \
    npm cache clean --force

# Stage 2: Build
FROM node:20.11.0-alpine3.19 AS build
WORKDIR /build

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY .eslintrc.json ./
COPY prisma ./prisma/

# Install all dependencies including dev for building
RUN npm ci --ignore-scripts && \
    npx prisma generate

# Copy source code
COPY src ./src

# Build application with optimizations
RUN npm run build && \
    npm prune --production && \
    rm -rf src tests .git .github

# Stage 3: Security scanner
FROM node:20.11.0-alpine3.19 AS security
WORKDIR /scan

COPY --from=build /build/package*.json ./
COPY --from=build /build/dist ./dist

# Run security audit (fails build if high severity vulnerabilities found)
RUN npm audit --audit-level=high --production

# Stage 4: Production
FROM node:20.11.0-alpine3.19 AS production

# Security hardening
RUN apk update && \
    apk upgrade && \
    apk add --no-cache \
    dumb-init=1.2.5-r3 \
    libcap=2.69-r1 && \
    rm -rf /var/cache/apk/* && \
    # Remove unnecessary packages and files
    rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /opt/yarn* \
    /tmp/* \
    /root/.npm \
    /root/.node-gyp && \
    # Create non-root user with specific UID/GID
    addgroup -g 10001 -S appuser && \
    adduser -u 10001 -S -G appuser -h /app appuser && \
    # Set up working directory with proper permissions
    mkdir -p /app && \
    chown -R appuser:appuser /app

WORKDIR /app

# Copy dumb-init for proper signal handling
COPY --from=dependencies --chown=appuser:appuser /usr/bin/dumb-init /usr/bin/dumb-init

# Copy production dependencies
COPY --from=dependencies --chown=appuser:appuser /build/node_modules ./node_modules

# Copy built application
COPY --from=build --chown=appuser:appuser /build/dist ./dist
COPY --from=build --chown=appuser:appuser /build/prisma ./prisma
COPY --from=build --chown=appuser:appuser /build/package.json ./package.json

# Security: Drop all capabilities and add only what's needed
RUN setcap -r /usr/local/bin/node || true

# Create necessary directories with proper permissions
RUN mkdir -p /app/logs /app/tmp && \
    chown -R appuser:appuser /app/logs /app/tmp && \
    chmod 750 /app/logs /app/tmp

# Health check script
RUN echo '#!/bin/sh\nwget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1' > /app/healthcheck.sh && \
    chmod +x /app/healthcheck.sh && \
    chown appuser:appuser /app/healthcheck.sh

# Switch to non-root user
USER appuser

# Security environment variables
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=2048 --enable-source-maps" \
    NPM_CONFIG_LOGLEVEL=error \
    PORT=3000

# Expose application port (non-privileged)
EXPOSE 3000

# Health check configuration
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
    CMD /app/healthcheck.sh

# Add metadata labels
LABEL maintainer="Enterprise Security Team" \
      version="1.0.0" \
      description="Secure MCP Server" \
      security.scan="enabled" \
      security.user="non-root" \
      security.capabilities="dropped"

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start application with reduced privileges
CMD ["node", "--enable-source-maps", "dist/index.js"]