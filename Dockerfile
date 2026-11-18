FROM node:20-alpine AS runtime

# Use Node.js headers bundled with the base image
ENV npm_config_nodedir=/usr/local

# Create working directory
WORKDIR /opt/app

RUN apk add --no-cache cmake make g++ python3 openssl-dev py3-setuptools git

# Copy and install dependencies
COPY package*.json ./

RUN npm ci --include=dev && npm cache clean --force

# Copy application files
COPY babel.config.js .
COPY tsconfig.json .
COPY src ./src
COPY scripts ./scripts

# Build project
RUN npm run build

# Expose application port
EXPOSE 3000

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

# Start app
CMD [ "npm", "start" ]

# Only this opt-in service receives the Docker socket.
FROM runtime AS updater
RUN apk add --no-cache docker-cli docker-cli-compose github-cli
ENTRYPOINT ["node", "dist/updater/index.js"]
CMD []

# Keep the historical default image lightweight and its entrypoint unchanged.
FROM runtime AS console
