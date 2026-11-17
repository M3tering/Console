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

# Optional browser image. Default builds below never install Chromium.
FROM runtime AS browser
RUN apk add --no-cache chromium openssl \
    && mkdir -p /opt/app/.data /opt/app/src/extensions /opt/app/dist/extensions \
    && chown -R node:node /opt/app/.data /opt/app/src/extensions /opt/app/dist/extensions
ENV BROWSER_EXECUTABLE=/usr/bin/chromium
USER node
# Build-only smoke check has no target service/network. Runtime requires sandbox.
RUN timeout 30 chromium --headless --no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --disable-background-networking --proxy-server=http://127.0.0.1:9 --dump-dom about:blank > /tmp/browser-smoke.html \
    && grep -q '<html' /tmp/browser-smoke.html && rm /tmp/browser-smoke.html

# Only this opt-in service receives the Docker socket.
FROM runtime AS updater
RUN apk add --no-cache docker-cli docker-cli-compose github-cli
ENTRYPOINT ["node", "dist/updater/index.js"]
CMD []

# Keep the historical default image lightweight and its entrypoint unchanged.
FROM runtime AS console
