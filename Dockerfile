# Build stage
FROM node:20-alpine AS builder

# Install build dependencies for node-gyp and native modules
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    sqlite-dev \
    pkgconfig

# Set environment variable for node-gyp to find Python
ENV PYTHON=/usr/bin/python3

# Install distutils for Python (required by node-gyp)
RUN pip3 install --break-system-packages setuptools

# Create working directory
WORKDIR /opt/app

# Copy dependency files
COPY package*.json ./
COPY babel.config.js tsconfig.json ./

# Configure npm for better Docker builds
RUN npm config set unsafe-perm true

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY src ./src

# Build the project
RUN npm run build

# Runtime stage  
FROM node:20-alpine AS runtime

# Install runtime dependencies only
RUN apk add --no-cache \
    python3 \
    py3-pip \
    sqlite

# Set environment variable for node-gyp to find Python
ENV PYTHON=/usr/bin/python3

# Install distutils for Python (required by some runtime native modules)
RUN pip3 install --break-system-packages setuptools

# Create working directory
WORKDIR /opt/app

# Copy package files
COPY package*.json ./

# Configure npm
RUN npm config set unsafe-perm true

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /opt/app/dist ./dist

# Copy other necessary files
COPY src/views ./src/views
COPY src/public ./src/public

# Copy .env file if it exists
COPY .env* ./

EXPOSE 3000

CMD ["npm", "start"]
