FROM node:20-alpine

# Create working directory
WORKDIR /opt/app

RUN apk add --no-cache cmake make g++ python3 openssl-dev py3-setuptools

# Copy and install dependencies
COPY package*.json ./

RUN npm install --include=dev && npm cache clean --force

# Copy application files
COPY babel.config.js .
COPY tsconfig.json .
COPY .env .
COPY src ./src
COPY console.config.jso[n] .

# Build project
RUN npm run build

# Expose application port
EXPOSE 3000

# Start app
CMD [ "npm", "start" ]
