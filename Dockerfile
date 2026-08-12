FROM node:22-slim AS builder

WORKDIR /build

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Debian, not Alpine, and not by preference: @tetherto/wdk-wallet-evm pulls in
# sodium-native, whose prebuilds cover linux-x64 (glibc) but not linux-x64-musl.
# On Alpine every worker tick died with "Cannot find addon".
#
# Migrations and the workers (issuer, relayer, settlement, monitor) run through
# ts-node, which the webpack bundle does not cover — they need the full tree.
FROM node:22-slim AS dev

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

CMD ["npm", "run", "dev"]

FROM node:22-slim

WORKDIR /app

# The production image says so itself. Note that an env_file mounted by
# docker-compose still overrides this, which is exactly how a deployment used
# to end up in development mode — the schema now has no default to fall back
# on, so a wrong or missing value fails the boot instead of degrading it.
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /build/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js"]
