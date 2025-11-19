FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Set environment
ENV NODE_ENV=production

# Run dmresponder
ENTRYPOINT ["node", "bin/run.js"]
CMD ["--help"]
