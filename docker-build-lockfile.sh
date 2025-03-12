#!/bin/bash

# Print status messages
echo "========================================"
echo "Starting Docker build with lockfile approach"
echo "========================================"

# Aggressively clean up Docker system
echo "Performing deep Docker cleanup..."
docker system prune -af --volumes
docker builder prune -af
docker image prune -af

# Set Docker BuildKit and larger timeout
export DOCKER_BUILDKIT=1
export DOCKER_CLIENT_TIMEOUT=120
export COMPOSE_HTTP_TIMEOUT=120

# Check internet connectivity
echo "Testing internet connectivity..."
if ! curl -s --head --fail https://registry.npmjs.org/ > /dev/null; then
  echo "Cannot reach npm registry. Please check your internet connection."
  exit 1
fi

# Build with lockfile approach and temporary disk space
echo "Building Docker image with lockfile approach..."
docker buildx build \
  --platform linux/arm64 \
  --file Dockerfile.lockfile \
  --progress=plain \
  --no-cache \
  --build-arg BUILDKIT_INLINE_CACHE=1 \
  --build-arg NODE_ENV=production \
  -t 399843200753.dkr.ecr.us-east-1.amazonaws.com/upwagmitech-node-app:latest \
  .

# Check if build was successful
if [ $? -eq 0 ]; then
  echo "========================================"
  echo "Build successful! Pushing to ECR..."
  echo "========================================"
  
  # Login to ECR
  aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 399843200753.dkr.ecr.us-east-1.amazonaws.com
  
  # Push with retries
  for attempt in {1..3}; do
    echo "Push attempt $attempt of 3..."
    if docker push 399843200753.dkr.ecr.us-east-1.amazonaws.com/upwagmitech-node-app:latest; then
      echo "========================================"
      echo "Image pushed successfully!"
      echo "========================================"
      exit 0
    fi
    echo "Push failed. Retrying in 5 seconds..."
    sleep 5
  done
  
  echo "All push attempts failed."
  exit 1
else
  echo "========================================"
  echo "Build failed. Please check the logs above for errors."
  echo "========================================"
  exit 1
fi 