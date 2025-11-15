FROM node:20-alpine

# Create working directory
WORKDIR /opt/app

# RUN apk add --no-cache cmake make g++ python3 openssl-dev py3-setuptools

# Optional: clean old node_modules if re-building
RUN rm -rf node_modules package-lock.json

# Copy and install dependencies
COPY package.json .
COPY package-lock.json .
COPY babel.config.js .
# COPY tsconfig.json .
COPY .env .
# COPY src ./src
COPY dist ./dist
RUN npm install

# Build project
# RUN npm run build

# Expose application port
EXPOSE 3000

# Start app
CMD [ "npm", "start" ]
