#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EntrixInfrastructureStack } from '../lib/infrastructure-stack';
import { EntrixPipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();

// Get environment configuration
const account = app.node.tryGetContext('account') || process.env.CDK_DEFAULT_ACCOUNT;
const region = 'eu-west-1';
const environment = app.node.tryGetContext('environment') || 'dev';
const githubOwner = app.node.tryGetContext('githubOwner') || 'aboualyXcode';
const githubRepo = app.node.tryGetContext('githubRepo') || 'wattsup';
const githubBranch = app.node.tryGetContext('githubBranch') || 'master';

const env: cdk.Environment = {
  account,
  region,
};

// Tags to apply to all resources
const commonTags: { [key: string]: string } = {
  Project: 'EntrixEnergyAuction',
  Environment: environment,
  ManagedBy: 'CDK',
  Owner: 'Mahmoud Aboualy',
};

// Infrastructure Stack - contains all application resources
const infrastructureStack = new EntrixInfrastructureStack(app, `EntrixInfrastructure-${environment}`, {
  env,
  environment,
  description: `Entrix Energy Auction Platform Infrastructure - ${environment}`,
  terminationProtection: environment === 'prod',
});

// Apply tags to infrastructure stack
Object.entries(commonTags).forEach(([key, value]) => {
  cdk.Tags.of(infrastructureStack).add(key, value);
});

// Pipeline Stack - CI/CD pipeline for deployments
const pipelineStack = new EntrixPipelineStack(app, `EntrixPipeline-${environment}`, {
  env,
  environment,
  githubOwner,
  githubRepo,
  githubBranch,
  description: `Entrix Energy Auction Platform Pipeline - ${environment}`,
});

// Apply tags to pipeline stack
Object.entries(commonTags).forEach(([key, value]) => {
  cdk.Tags.of(pipelineStack).add(key, value);
});

app.synth();
