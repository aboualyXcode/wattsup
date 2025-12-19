# WattsUp

This repo defines the AWS CDK (TypeScript) infrastructure for deploying an energy market auction system, including Lambda-based data pipelines with validation and retries, error notifications, data expiration, and automated CI/CD deployment to AWS on merges to master.

## Prerequisites

- Node.js 20+
- Python 3.12+
- AWS CLI configured
- AWS CDK bootstrapped (`cdk bootstrap`)

## Quick Start

```bash
make install           # Install all dependencies
make lint-python       # Lint Python code
make lint-node         # Lint TypeScript code
make test-python       # Run Python tests
make test-node         # Run CDK tests
```

## Deployment

**First-time setup:**

1. Create the Slack webhook secret in AWS Secrets Manager:
   ```bash
   aws secretsmanager create-secret \
     --name entrix/slack-webhook-dev \
     --secret-string "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
   ```

2. Create the JWT secret for API authentication (see [API Authentication](#api-authentication) section for details):
   ```bash
   JWT_SECRET=$(openssl rand -base64 32)
   echo "Save this secret: $JWT_SECRET"
   
   aws secretsmanager create-secret \
     --name entrix/jwt-secret-dev \
     --secret-string "$JWT_SECRET"
   ```

3. Deploy the pipeline stack:
   ```bash
   make deploy-pipeline
   ```

4. Authorize the GitHub connection in the AWS Console (CodePipeline > Settings > Connections).

```bash
make deploy-pipeline   # Deploy CI/CD pipeline
make deploy-infra      # Deploy infrastructure (manual)
```

## API Authentication

The API uses JWT tokens for authentication. Setup requires two steps:

### Step 1: Create JWT Secret (before deployment)

Generate a secret key and store it in AWS Secrets Manager. This key is used to sign and verify tokens:

```bash
# Generate a secure random key and save it (you'll need this to generate tokens)
JWT_SECRET=$(openssl rand -base64 32)
echo "Save this secret: $JWT_SECRET"

# Store in AWS Secrets Manager
aws secretsmanager create-secret \
  --name entrix/jwt-secret-dev \
  --secret-string "$JWT_SECRET"
```

### Step 2: Generate Tokens (after deployment)

Use the **same secret key** from Step 1 to generate JWT tokens for API calls:

```python
import jwt

# Use the SAME secret from Step 1
JWT_SECRET = "your-secret-from-step-1"

YOUR_JWT_TOKEN = jwt.encode(
    {"sub": "user123", "email": "user@example.com"},
    JWT_SECRET,
    algorithm="HS256"
)
print(YOUR_JWT_TOKEN)
```

### Step 3: Call the API

Include the token in the Authorization header:

```bash
curl -X POST https://your-api-url/dev/orders \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"record_id": "unique_id_1", "parameter_1": "abc", "parameter_2": 4},
    {"record_id": "unique_id_2", "parameter_1": "def", "parameter_2": 2.1}
  ]'
```

## CI/CD

- **GitHub Actions:** Runs linting and tests on all PRs and pushes to `master`
- **CodePipeline:** Automatically deploys to Dev when changes are merged to `master`

## Project Structure

```
wattsup/
├── cloud-infra/       # CDK infrastructure code
├── wattsup-app/       # Lambda functions (Python)
│   ├── authorizer_lambda/  # JWT authorizer
│   ├── post_lambda/        # POST /orders handler
│   ├── lambda_a/           # Data pipeline step 1
│   └── lambda_b/           # Data pipeline step 2
└── Makefile           # Common commands
```
