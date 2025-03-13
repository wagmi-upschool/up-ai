# Build stage
FROM node:18-alpine AS builder

# Set the working directory
WORKDIR /usr/src/app

# Install Python and build dependencies needed for node-gyp
RUN apk add --no-cache python3 make g++ gcc

# Copy package.json and package-lock.json
COPY package*.json ./

# Install only production dependencies with specific flags to reduce size
RUN npm install --only=production --no-package-lock --no-fund --prefer-offline && \
    npm cache clean --force

# Copy the rest of the application code
COPY . .

# Final stage
FROM node:18-alpine

# Set the working directory
WORKDIR /usr/src/app

# Copy only the node_modules and application files from the builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/. .

# Expose the port the app runs on
EXPOSE 3000

# Define the command to run the app
CMD ["node", "app.js"]