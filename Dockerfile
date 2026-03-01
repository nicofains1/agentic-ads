FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++ && \
    npm ci --only=production && \
    apk del python3 make g++
COPY --from=builder /app/dist ./dist
RUN mkdir -p /data
ENV DATABASE_PATH=/data/agentic-ads.db
EXPOSE 3000
CMD ["node", "dist/server.js", "--http"]
