FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built files
COPY dist ./dist

# Copy startup script
COPY scripts/start.sh ./scripts/start.sh
RUN chmod +x scripts/start.sh

# SQLite database will be stored in /data (persistent volume mount point)
RUN mkdir -p /data
ENV DATABASE_PATH=/data/agentic-ads.db

EXPOSE 3000

CMD ["sh", "scripts/start.sh"]
