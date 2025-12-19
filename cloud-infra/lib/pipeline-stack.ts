import * as cdk from 'aws-cdk-lib';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipelineActions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codestarconnections from 'aws-cdk-lib/aws-codestarconnections';
import { Construct } from 'constructs';

export interface EntrixPipelineStackProps extends cdk.StackProps {
  environment: string;
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
}

export class EntrixPipelineStack extends cdk.Stack {
  public readonly pipeline: codepipeline.Pipeline;

  constructor(scope: Construct, id: string, props: EntrixPipelineStackProps) {
    super(scope, id, props);

    const { environment, githubOwner, githubRepo, githubBranch } = props;

    // GitHub Connection (CodeStar Connections)
    const githubConnection = new codestarconnections.CfnConnection(this, 'GitHubConnection', {
      connectionName: `entrix-github-${environment}`,
      providerType: 'GitHub',
    });

    // Artifacts
    const sourceOutput = new codepipeline.Artifact('SourceOutput');
    const buildOutput = new codepipeline.Artifact('BuildOutput');

    // CodeBuild Project: Build and Synth CDK
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      projectName: `entrix-build-${environment}`,
      description: 'Build and synthesize CDK application',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        environmentVariables: {
          ENVIRONMENT: { value: environment },
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '20',
              python: '3.12',
            },
            commands: [
              'cd $CODEBUILD_SRC_DIR/cloud-infra && npm ci',
            ],
          },
          build: {
            commands: [
              'cd $CODEBUILD_SRC_DIR/cloud-infra && npm run build',
              'cd $CODEBUILD_SRC_DIR/cloud-infra && npm run synth',
            ],
          },
        },
        artifacts: {
          'base-directory': 'cloud-infra/cdk.out',
          files: ['**/*'],
        },
      }),
      timeout: cdk.Duration.minutes(15),
    });

    // CodeBuild Project: Deploy
    const deployProject = new codebuild.PipelineProject(this, 'DeployProject', {
      projectName: `entrix-deploy-${environment}`,
      description: 'Deploy CDK application',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        environmentVariables: {
          ENVIRONMENT: { value: environment },
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '20',
            },
            commands: [
              'npm install -g aws-cdk',
            ],
          },
          build: {
            commands: [
              `cdk deploy EntrixInfrastructure-${environment} --require-approval never --app .`,
            ],
          },
        },
      }),
      timeout: cdk.Duration.minutes(30),
    });

    // Grant deploy permissions - scoped to specific services and resources
    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'CloudFormationPermissions',
      actions: [
        'cloudformation:CreateStack',
        'cloudformation:UpdateStack',
        'cloudformation:DeleteStack',
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackEvents',
        'cloudformation:DescribeStackResources',
        'cloudformation:GetTemplate',
        'cloudformation:ValidateTemplate',
        'cloudformation:CreateChangeSet',
        'cloudformation:DescribeChangeSet',
        'cloudformation:ExecuteChangeSet',
        'cloudformation:DeleteChangeSet',
        'cloudformation:GetStackPolicy',
        'cloudformation:SetStackPolicy',
      ],
      resources: [
        `arn:aws:cloudformation:${this.region}:${this.account}:stack/EntrixInfrastructure-${environment}/*`,
        `arn:aws:cloudformation:${this.region}:${this.account}:stack/CDKToolkit/*`,
      ],
    }));

    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'LambdaPermissions',
      actions: [
        'lambda:CreateFunction',
        'lambda:UpdateFunctionCode',
        'lambda:UpdateFunctionConfiguration',
        'lambda:DeleteFunction',
        'lambda:GetFunction',
        'lambda:GetFunctionConfiguration',
        'lambda:AddPermission',
        'lambda:RemovePermission',
        'lambda:InvokeFunction',
        'lambda:ListTags',
        'lambda:TagResource',
        'lambda:UntagResource',
      ],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:entrix-*-${environment}`],
    }));

    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'APIGatewayPermissions',
      actions: [
        'apigateway:GET',
        'apigateway:POST',
        'apigateway:PUT',
        'apigateway:DELETE',
        'apigateway:PATCH',
      ],
      resources: [`arn:aws:apigateway:${this.region}::/*`],
    }));

    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'DynamoDBPermissions',
      actions: [
        'dynamodb:CreateTable',
        'dynamodb:UpdateTable',
        'dynamodb:DeleteTable',
        'dynamodb:DescribeTable',
        'dynamodb:DescribeContinuousBackups',
        'dynamodb:UpdateContinuousBackups',
        'dynamodb:ListTagsOfResource',
        'dynamodb:TagResource',
        'dynamodb:UntagResource',
        'dynamodb:DescribeTimeToLive',
        'dynamodb:UpdateTimeToLive',
      ],
      resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/entrix-*-${environment}`],
    }));

    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'S3Permissions',
      actions: [
        's3:CreateBucket',
        's3:DeleteBucket',
        's3:GetBucketPolicy',
        's3:PutBucketPolicy',
        's3:DeleteBucketPolicy',
        's3:GetBucketVersioning',
        's3:PutBucketVersioning',
        's3:GetEncryptionConfiguration',
        's3:PutEncryptionConfiguration',
        's3:GetBucketPublicAccessBlock',
        's3:PutBucketPublicAccessBlock',
        's3:GetLifecycleConfiguration',
        's3:PutLifecycleConfiguration',
        's3:GetBucketTagging',
        's3:PutBucketTagging',
        's3:ListBucket',
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
      ],
      resources: [
        `arn:aws:s3:::order-results-${environment}-${this.account}`,
        `arn:aws:s3:::order-results-${environment}-${this.account}/*`,
        `arn:aws:s3:::cdk-*-assets-${this.account}-${this.region}`,
        `arn:aws:s3:::cdk-*-assets-${this.account}-${this.region}/*`,
      ],
    }));

    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'SNSPermissions',
      actions: [
        'sns:CreateTopic',
        'sns:DeleteTopic',
        'sns:GetTopicAttributes',
        'sns:SetTopicAttributes',
        'sns:Subscribe',
        'sns:Unsubscribe',
        'sns:ListTagsForResource',
        'sns:TagResource',
        'sns:UntagResource',
      ],
      resources: [`arn:aws:sns:${this.region}:${this.account}:entrix-*-${environment}`],
    }));

    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'StepFunctionsPermissions',
      actions: [
        'states:CreateStateMachine',
        'states:UpdateStateMachine',
        'states:DeleteStateMachine',
        'states:DescribeStateMachine',
        'states:ListTagsForResource',
        'states:TagResource',
        'states:UntagResource',
      ],
      resources: [`arn:aws:states:${this.region}:${this.account}:stateMachine:entrix-*-${environment}`],
    }));

    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'CloudWatchLogsPermissions',
      actions: [
        'logs:CreateLogGroup',
        'logs:DeleteLogGroup',
        'logs:DescribeLogGroups',
        'logs:PutRetentionPolicy',
        'logs:DeleteRetentionPolicy',
        'logs:ListTagsLogGroup',
        'logs:TagLogGroup',
        'logs:UntagLogGroup',
      ],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/*/entrix-*-${environment}:*`],
    }));

    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'CloudWatchPermissions',
      actions: [
        'cloudwatch:PutMetricAlarm',
        'cloudwatch:DeleteAlarms',
        'cloudwatch:DescribeAlarms',
        'cloudwatch:PutDashboard',
        'cloudwatch:DeleteDashboards',
        'cloudwatch:GetDashboard',
        'cloudwatch:ListTagsForResource',
        'cloudwatch:TagResource',
        'cloudwatch:UntagResource',
      ],
      resources: ['*'],
    }));

    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'EventBridgePermissions',
      actions: [
        'events:PutRule',
        'events:DeleteRule',
        'events:DescribeRule',
        'events:PutTargets',
        'events:RemoveTargets',
        'events:ListTagsForResource',
        'events:TagResource',
        'events:UntagResource',
      ],
      resources: [`arn:aws:events:${this.region}:${this.account}:rule/entrix-*-${environment}`],
    }));

    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'IAMRolePermissions',
      actions: [
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:GetRole',
        'iam:UpdateRole',
        'iam:PassRole',
        'iam:AttachRolePolicy',
        'iam:DetachRolePolicy',
        'iam:PutRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:GetRolePolicy',
        'iam:ListRolePolicies',
        'iam:ListAttachedRolePolicies',
        'iam:TagRole',
        'iam:UntagRole',
      ],
      resources: [
        `arn:aws:iam::${this.account}:role/EntrixInfrastructure-${environment}*`,
        `arn:aws:iam::${this.account}:role/cdk-*-${this.account}-${this.region}`,
      ],
    }));

    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'SSMParameterPermissions',
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:PutParameter',
        'ssm:DeleteParameter',
      ],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/*`],
    }));

    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'SecretsManagerPermissions',
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
      ],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:entrix/*`],
    }));

    // CDK Bootstrap roles - required for CDK deployments
    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'CDKAssumeBootstrapRoles',
      actions: ['sts:AssumeRole'],
      resources: [
        `arn:aws:iam::${this.account}:role/cdk-hnb659fds-deploy-role-${this.account}-${this.region}`,
        `arn:aws:iam::${this.account}:role/cdk-hnb659fds-file-publishing-role-${this.account}-${this.region}`,
        `arn:aws:iam::${this.account}:role/cdk-hnb659fds-image-publishing-role-${this.account}-${this.region}`,
        `arn:aws:iam::${this.account}:role/cdk-hnb659fds-lookup-role-${this.account}-${this.region}`,
        `arn:aws:iam::${this.account}:role/cdk-hnb659fds-cfn-exec-role-${this.account}-${this.region}`,
      ],
    }));

    // CDK Assets bucket - required for uploading Lambda code and other assets
    deployProject.addToRolePolicy(new iam.PolicyStatement({
      sid: 'CDKAssetsBucketAccess',
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:ListBucket',
        's3:GetBucketLocation',
      ],
      resources: [
        `arn:aws:s3:::cdk-hnb659fds-assets-${this.account}-${this.region}`,
        `arn:aws:s3:::cdk-hnb659fds-assets-${this.account}-${this.region}/*`,
      ],
    }));

    // CodePipeline
    this.pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: `entrix-pipeline-${environment}`,
      restartExecutionOnUpdate: true,
      crossAccountKeys: false,
    });

    // Source Stage
    this.pipeline.addStage({
      stageName: 'Source',
      actions: [
        new codepipelineActions.CodeStarConnectionsSourceAction({
          actionName: 'GitHub_Source',
          connectionArn: githubConnection.attrConnectionArn,
          owner: githubOwner,
          repo: githubRepo,
          branch: githubBranch,
          output: sourceOutput,
          triggerOnPush: true,
        }),
      ],
    });

    // Build Stage
    this.pipeline.addStage({
      stageName: 'Build',
      actions: [
        new codepipelineActions.CodeBuildAction({
          actionName: 'Build_And_Synth',
          project: buildProject,
          input: sourceOutput,
          outputs: [buildOutput],
        }),
      ],
    });

    // Deploy Stage
    this.pipeline.addStage({
      stageName: 'Deploy',
      actions: [
        new codepipelineActions.CodeBuildAction({
          actionName: 'Deploy_To_Dev',
          project: deployProject,
          input: buildOutput,
        }),
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'PipelineName', {
      value: this.pipeline.pipelineName,
      description: 'CodePipeline name',
      exportName: `EntrixPipelineName-${environment}`,
    });

    new cdk.CfnOutput(this, 'GitHubConnectionArn', {
      value: githubConnection.attrConnectionArn,
      description: 'GitHub connection ARN - must be manually authorized in AWS Console',
      exportName: `EntrixGitHubConnectionArn-${environment}`,
    });
  }
}
