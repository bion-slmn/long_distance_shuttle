# ---- Base ----
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate
WORKDIR /app

# ---- Dependencies (all, for building) ----
FROM base AS deps
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

# ---- Build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- Production dependencies only (no devDeps) ----
FROM base AS prod-deps
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile --prod

# ---- Final runtime image ----
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# non-root user, alpine already has 'node' user via base image but not in bare alpine — this is safe here since base is node:20-alpine
USER node

EXPOSE 3000
CMD ["node", "dist/src/main.js"]