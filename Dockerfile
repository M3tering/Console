FROM node:20-alpine

# Install build dependencies for node-gyp
RUN apk add --no-cache python3 make g++

# Set environment variable for node-gyp to find Python
ENV PYTHON=/usr/bin/python3

# Create working directory
WORKDIR /opt/app

# Copy dependency files
COPY package*.json ./
COPY babel.config.js tsconfig.json ./
COPY .env ./

# Install dependencies
RUN npm install

# Copy source
COPY src ./src

# Build project
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
