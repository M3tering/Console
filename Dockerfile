FROM node:20-alpine

# Create working directory
WORKDIR /opt/app

RUN apk add --no-cache cmake make g++ python3 openssl-dev py3-setuptools git

# Copy and install dependencies
COPY package*.json ./

RUN npm install --include=dev && npm cache clean --force

# Copy application files
COPY babel.config.js .
COPY tsconfig.json .
COPY .env .
COPY src ./src

# Build project
RUN npm run build

# Expose application port
EXPOSE 3000

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

# Start app
CMD [ "npm", "start" ]
