#!/bin/bash

# Clean up Docker system before building
echo "Cleaning up Docker system..."
docker system prune -af --volumes

# Remove any existing images to free up space
echo "Removing existing images..."
docker rmi -f $(docker images -q) 2>/dev/null || true

# Set Docker BuildKit environment variable
export DOCKER_BUILDKIT=1

# Build using the Alpine-specific Dockerfile
echo "Building Docker image with Alpine base..."
docker buildx build \
  --platform linux/arm64 \
  --file Dockerfile.alpine \
  --build-arg BUILDKIT_INLINE_CACHE=1 \
  --build-arg NODE_ENV=production \
  --no-cache \
  --progress=plain \
  -t 399843200753.dkr.ecr.us-east-1.amazonaws.com/upwagmitech-node-app:latest \
  .

# Check if build was successful
if [ $? -eq 0 ]; then
  echo "Build successful! Pushing to ECR..."
  aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 399843200753.dkr.ecr.us-east-1.amazonaws.com
  docker push 399843200753.dkr.ecr.us-east-1.amazonaws.com/upwagmitech-node-app:latest
  echo "Image pushed successfully!"
else
  echo "Build failed. Please check the logs above for errors."
  exit 1
fi 