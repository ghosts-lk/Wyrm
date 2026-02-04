# 🐉 Wyrm Dockerfile
# Multi-stage build for optimal image size

FROM node:20-alpine AS builder

WORKDIR /build

# Copy package files
COPY packages/mcp-server/package*.json ./
RUN npm ci --only=production

# Copy source and build
COPY packages/mcp-server/tsconfig.json ./
COPY packages/mcp-server/src ./src
RUN npm run build

# Production image
FROM node:20-alpine

LABEL org.opencontainers.image.title="Wyrm"
LABEL org.opencontainers.image.description="Persistent AI Memory System with MCP support"
LABEL org.opencontainers.image.version="3.0.0"
LABEL org.opencontainers.image.vendor="Ghost Protocol (Pvt) Ltd"
LABEL org.opencontainers.image.url="https://ghosts.lk/wyrm"
LABEL org.opencontainers.image.source="https://github.com/Ghosts-Protocol-Pvt-Ltd/Wyrm"
LABEL org.opencontainers.image.licenses="Proprietary"

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package.json ./

# Create data directory for SQLite
RUN mkdir -p /data && chown -R node:node /data

# Switch to non-root user
USER node

# Expose HTTP server port
EXPOSE 3333

# Environment variables
ENV NODE_ENV=production
ENV WYRM_DATA_DIR=/data
ENV PORT=3333

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3333/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Default to HTTP server
CMD ["node", "dist/http-fast.js"]
