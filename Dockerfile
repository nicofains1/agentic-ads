FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built files
COPY dist ./dist

# SQLite database will be stored in /data
RUN mkdir -p /data
ENV DATABASE_PATH=/data/agentic-ads.db

EXPOSE 3000

CMD ["node", "dist/server.js", "--http", "--port", "3000"]
