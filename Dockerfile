FROM node:20-alpine

# Create working directory
WORKDIR /opt/app

RUN apk add --no-cache alpine-sdk cmake python3 openssl-dev

# Copy and install dependencies
COPY package.json .
COPY package-lock.json .
COPY babel.config.js .
COPY tsconfig.json .
COPY .env .
COPY src ./src
RUN npm install

# Build project
RUN npm run build

# Expose application port
EXPOSE 3000

# Start app
CMD [ "npm", "start" ]
