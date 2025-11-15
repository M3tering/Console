#!/bin/bash

# exit immediately if a command exits with a non-zero status
set -e

# run npm install to install dependencies
npm install

# run the build script defined in package.json
npm run build

# print a message indicating the build is complete
echo "Build complete!"  

# build docker image
docker compose up --build -d
echo "Docker image built and containers are up!"