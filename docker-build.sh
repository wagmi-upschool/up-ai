#!/bin/bash

# Clean up Docker system before building
echo "Cleaning up Docker system..."
docker system prune -f --volumes

# Set Docker BuildKit environment variable for better caching and performance
export DOCKER_BUILDKIT=1

# Build the Docker image with specific build arguments to optimize space
echo "Building Docker image..."
docker buildx build \
  --platform linux/arm64 \
  --build-arg BUILDKIT_INLINE_CACHE=1 \
  --build-arg NODE_ENV=production \
  --progress=plain \
  --no-cache \
  -t 399843200753.dkr.ecr.us-east-1.amazonaws.com/upwagmitech-node-app:latest \
  .

# Check if build was successful
if [ $? -eq 0 ]; then
  echo "Build successful! Pushing to ECR..."
  docker push 399843200753.dkr.ecr.us-east-1.amazonaws.com/upwagmitech-node-app:latest
  echo "Image pushed successfully!"
else
  echo "Build failed. Please check the logs above for errors."
  exit 1
fi 