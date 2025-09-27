# GitHub Secrets Configuration

This document lists all the GitHub Secrets required for CI/CD pipelines to work properly.

## Required Secrets

### 1. Security Scanning
- **SNYK_TOKEN**: Token for Snyk security scanning
  - Get it from: https://app.snyk.io/account
  - Required for: Security vulnerability scanning in CI pipeline

### 2. Docker Registry (if using Docker Hub)
- **DOCKERHUB_USERNAME**: Docker Hub username
- **DOCKERHUB_TOKEN**: Docker Hub access token
  - Get it from: https://hub.docker.com/settings/security
  - Required for: Pushing Docker images in CD pipeline

### 3. Azure Deployment (if deploying to Azure)
- **AZURE_CREDENTIALS**: Azure service principal credentials
  - Format: JSON object with clientId, clientSecret, subscriptionId, tenantId
  - Required for: Azure Kubernetes Service deployment
  - Create with: `az ad sp create-for-rbac --sdk-auth`

### 4. Vault Integration (if using HashiCorp Vault)
- **VAULT_TOKEN**: HashiCorp Vault access token
  - Required for: Secrets management in production
  - Get from your Vault administrator

### 5. Additional Optional Secrets
- **SONAR_TOKEN**: SonarCloud token for code quality analysis
- **SLACK_WEBHOOK**: Slack webhook URL for notifications
- **NPM_TOKEN**: NPM registry token for private packages

## How to Add Secrets to GitHub

1. Go to your repository on GitHub
2. Click on Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Add each secret with the exact name listed above
5. Paste the secret value and click "Add secret"

## Workflows Status

The workflows are currently **DISABLED** (renamed with .disabled extension) until secrets are configured.

To enable workflows after adding secrets:
```bash
mv .github/workflows/ci.yml.disabled .github/workflows/ci.yml
mv .github/workflows/cd.yml.disabled .github/workflows/cd.yml
```

## Testing Secrets

After adding secrets, you can test them by:
1. Creating a test branch
2. Making a small change
3. Opening a pull request to trigger the CI workflow

## Security Notes

- Never commit secrets to the repository
- Rotate secrets regularly
- Use least-privilege access for service accounts
- Enable secret scanning on your repository