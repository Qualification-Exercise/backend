FROM node:22-alpine AS builder

WORKDIR /build

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Migrations and the workers (issuer, relayer, settlement, monitor) run through
# ts-node, which the webpack bundle does not cover — they need the full tree.
FROM node:22-alpine AS dev

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

CMD ["npm", "run", "dev"]

FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /build/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js"]
