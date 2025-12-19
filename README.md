# WattsUp

This repo defines the AWS CDK (TypeScript) infrastructure for deploying an energy market auction system, including Lambda-based data pipelines with validation and retries, error notifications, data expiration, and automated CI/CD deployment to AWS on merges to master.

## What you need

- Node.js 20+
- Python 3.12+
- AWS CLI configured
- AWS CDK bootstrapped (`cdk bootstrap`)

## Getting started
```bash
make install-python    # Set up Python environment
make install-node      # Install Node dependencies
make lint-python       # Check Python code
make lint-node         # Check TypeScript code
make test-python       # Run Python tests
make test-node         # Run CDK tests
```

## Deploying

### First time setup

**1. Add your Slack webhook:**
```bash
aws secretsmanager create-secret \
  --name entrix/slack-webhook-dev \
  --secret-string "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

**2. Create a JWT secret:**
```bash
JWT_SECRET=$(openssl rand -base64 32)
echo "Save this: $JWT_SECRET"

aws secretsmanager create-secret \
  --name entrix/jwt-secret-dev \
  --secret-string "$JWT_SECRET"
```

**3. Deploy the pipeline:**
```bash
make deploy-pipeline
```

**4. Authorize GitHub connection** in AWS Console (CodePipeline → Settings → Connections).

### Subsequent deploys
```bash
make deploy-pipeline   # Deploy CI/CD pipeline
make deploy-infra      # Deploy infrastructure manually
```

## Using the API

The API uses JWT tokens. Here's how to set it up:

### Generate a token

Use the secret from your initial setup:
```python
import jwt

JWT_SECRET = "your-secret-from-setup"

token = jwt.encode(
    {"sub": "user123", "email": "user@example.com"},
    JWT_SECRET,
    algorithm="HS256"
)
print(token)
```

### Make a request
```bash
curl -X POST https://your-api-url/dev/orders \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '[
    {"record_id": "unique_id_1", "parameter_1": "abc", "parameter_2": 4},
    {"record_id": "unique_id_2", "parameter_1": "def", "parameter_2": 2.1}
  ]'
```

## How it works

- **GitHub Actions** runs tests on PRs and pushes to `master`
- **CodePipeline** auto-deploys to Dev when you merge to `master`

## Structure
```
wattsup/
├── cloud-infra/            # CDK infrastructure
├── wattsup-app/            # Lambda functions
│   ├── authorizer_lambda/  # JWT auth
│   ├── post_lambda/        # POST /orders
│   ├── lambda_a/           # Pipeline step 1
│   └── lambda_b/           # Pipeline step 2
└── Makefile                # Build commands