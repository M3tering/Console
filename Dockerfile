FROM node:20-alpine

# Create working directory
RUN mkdir -p /opt/app
WORKDIR /opt/app.

# Copy and install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy source and config files
COPY tsconfig.json ./
COPY .env ./
COPY src/ ./src/

# Build project
RUN npm run build

# Expose application port
EXPOSE 3000

# Start app
CMD [ "npm", "start"]
