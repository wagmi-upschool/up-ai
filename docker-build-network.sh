#!/bin/bash

# Print status messages
echo "========================================"
echo "Starting Docker build with network fixes"
echo "========================================"

# Aggressively clean up Docker system
echo "Performing deep Docker cleanup..."
docker system prune -af --volumes
docker builder prune -af
docker image prune -af

# Clear npm cache on host to ensure a clean start
echo "Clearing local npm cache..."
npm cache clean --force

# Set Docker BuildKit and larger timeout
export DOCKER_BUILDKIT=1
export DOCKER_CLIENT_TIMEOUT=120
export COMPOSE_HTTP_TIMEOUT=120

# Test internet connectivity first
echo "Testing internet connectivity..."
curl -I https://registry.npmjs.org/ || {
  echo "Cannot reach npm registry. Check your internet connection."
  exit 1
}

# Build with extended timeouts and retry logic
echo "Building Docker image with extended timeouts..."
docker buildx build \
  --platform linux/arm64 \
  --file Dockerfile.network \
  --progress=plain \
  --no-cache \
  --network=host \
  --build-arg BUILDKIT_INLINE_CACHE=1 \
  --build-arg NODE_ENV=production \
  -t 399843200753.dkr.ecr.us-east-1.amazonaws.com/upwagmitech-node-app:latest \
  .

# Check build result
if [ $? -eq 0 ]; then
  echo "========================================"
  echo "Build successful! Pushing to ECR..."
  echo "========================================"
  
  # Login to ECR
  aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 399843200753.dkr.ecr.us-east-1.amazonaws.com
  
  # Push image with retry logic
  MAX_RETRIES=3
  RETRY_COUNT=0
  
  while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if docker push 399843200753.dkr.ecr.us-east-1.amazonaws.com/upwagmitech-node-app:latest; then
      echo "========================================"
      echo "Image pushed successfully!"
      echo "========================================"
      exit 0
    else
      RETRY_COUNT=$((RETRY_COUNT+1))
      echo "Push failed. Retry $RETRY_COUNT of $MAX_RETRIES..."
      sleep 5
    fi
  done
  
  echo "Failed to push image after $MAX_RETRIES attempts."
  exit 1
else
  echo "========================================"
  echo "Build failed. Please check the logs above for errors."
  echo "========================================"
  exit 1
fi 