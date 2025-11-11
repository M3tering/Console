FROM node:20-alpine

# Install build dependencies required by node-gyp
RUN apk add --no-cache python3 make g++ \
 && npm config set python /usr/bin/python3

# Create working directory
WORKDIR /opt/app

# Copy dependency files first (for layer caching)
COPY package*.json ./
COPY babel.config.js tsconfig.json ./
COPY .env ./

# Install dependencies
RUN npm install

# Copy application source
COPY src ./src

# Build project
RUN npm run build

# Expose port
EXPOSE 3000

# Start app
CMD ["npm", "start"]
