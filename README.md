# up-ai

## Login

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 399843200753.dkr.ecr.us-east-1.amazonaws.com\
```

## Build and push

```bash
docker buildx build --platform linux/arm64 -t 399843200753.dkr.ecr.us-east-1.amazonaws.com/upwagmitech-node-app:latest . --push\
```
