# Multi-stage build for Next.js app with Docker CLI available at runtime for MCP
# Builder stage: install all deps, build, then prune dev deps
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Install dependencies (include dev deps for build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Prune dev dependencies for runtime
RUN npm prune --omit=dev

# Runtime stage: add Docker CLI and tini so the app can run MCP via `docker run`
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install docker CLI + tini
RUN apt-get update \
    && apt-get install -y --no-install-recommends docker.io tini \
    && rm -rf /var/lib/apt/lists/*

# Copy built artifacts and needed files
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/src ./src
COPY --from=builder /app/mcp-config.json ./mcp-config.json
COPY --from=builder /app/prompt ./prompt
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder /app/eslint.config.mjs ./eslint.config.mjs
COPY --from=builder /app/jsconfig.json ./jsconfig.json

# Expose Next.js port
EXPOSE 3000

# Start the app
CMD ["tini", "--", "npm", "run", "start"]