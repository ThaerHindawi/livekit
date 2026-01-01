# Node.js App Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY server.js ./
COPY public ./public

# Expose port
EXPOSE 3000

# Start the app
CMD ["node", "server.js"]

