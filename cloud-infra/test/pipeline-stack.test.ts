import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { EntrixPipelineStack } from '../lib/pipeline-stack';

describe('EntrixPipelineStack', () => {
  let app: cdk.App;
  let stack: EntrixPipelineStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new EntrixPipelineStack(app, 'TestPipelineStack', {
      environment: 'dev',
      githubOwner: 'test-owner',
      githubRepo: 'test-repo',
      githubBranch: 'master',
      env: { account: '123456789012', region: 'eu-west-1' },
    });
    template = Template.fromStack(stack);
  });

  describe('CodeStar Connection', () => {
    test('creates a GitHub connection', () => {
      template.hasResourceProperties('AWS::CodeStarConnections::Connection', {
        ConnectionName: 'entrix-github-dev',
        ProviderType: 'GitHub',
      });
    });
  });

  describe('CodePipeline', () => {
    test('creates a CodePipeline', () => {
      template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
        Name: 'entrix-pipeline-dev',
      });
    });

    test('pipeline has three stages', () => {
      template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
        Stages: Match.arrayWith([
          Match.objectLike({ Name: 'Source' }),
          Match.objectLike({ Name: 'Build' }),
          Match.objectLike({ Name: 'Deploy' }),
        ]),
      });
    });

    test('source stage uses CodeStar connection for GitHub', () => {
      template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
        Stages: Match.arrayWith([
          Match.objectLike({
            Name: 'Source',
            Actions: Match.arrayWith([
              Match.objectLike({
                ActionTypeId: {
                  Category: 'Source',
                  Owner: 'AWS',
                  Provider: 'CodeStarSourceConnection',
                  Version: '1',
                },
                Configuration: Match.objectLike({
                  BranchName: 'master',
                }),
              }),
            ]),
          }),
        ]),
      });
    });
  });

  describe('CodeBuild Projects', () => {
    test('creates build project', () => {
      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Name: 'entrix-build-dev',
        Description: 'Build and synthesize CDK application',
        Environment: {
          Image: 'aws/codebuild/standard:7.0',
          ComputeType: 'BUILD_GENERAL1_SMALL',
          Type: 'LINUX_CONTAINER',
        },
      });
    });

    test('creates deploy project', () => {
      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Name: 'entrix-deploy-dev',
        Description: 'Deploy CDK application',
        Environment: {
          Image: 'aws/codebuild/standard:7.0',
          ComputeType: 'BUILD_GENERAL1_SMALL',
        },
      });
    });

    test('build project has 15 minute timeout', () => {
      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Name: 'entrix-build-dev',
        TimeoutInMinutes: 15,
      });
    });

    test('deploy project has 30 minute timeout', () => {
      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Name: 'entrix-deploy-dev',
        TimeoutInMinutes: 30,
      });
    });

    test('deploy project has scoped IAM permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'CloudFormationPermissions',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });
  });

  describe('Stack Outputs', () => {
    test('exports pipeline name', () => {
      template.hasOutput('PipelineName', {
        Export: {
          Name: 'EntrixPipelineName-dev',
        },
      });
    });

    test('exports GitHub connection ARN', () => {
      template.hasOutput('GitHubConnectionArn', {
        Export: {
          Name: 'EntrixGitHubConnectionArn-dev',
        },
      });
    });
  });
});

describe('EntrixPipelineStack - Different Branches', () => {
  test('can configure different branch', () => {
    const app = new cdk.App();
    const stack = new EntrixPipelineStack(app, 'FeatureStack', {
      environment: 'staging',
      githubOwner: 'test-owner',
      githubRepo: 'test-repo',
      githubBranch: 'develop',
      env: { account: '123456789012', region: 'eu-west-1' },
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
      Stages: Match.arrayWith([
        Match.objectLike({
          Name: 'Source',
          Actions: Match.arrayWith([
            Match.objectLike({
              Configuration: Match.objectLike({
                BranchName: 'develop',
              }),
            }),
          ]),
        }),
      ]),
    });
  });
});
