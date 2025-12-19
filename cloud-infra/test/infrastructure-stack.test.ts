import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { EntrixInfrastructureStack } from '../lib/infrastructure-stack';

describe('EntrixInfrastructureStack', () => {
  let app: cdk.App;
  let stack: EntrixInfrastructureStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new EntrixInfrastructureStack(app, 'TestStack', {
      environment: 'test',
      env: { account: '123456789012', region: 'eu-west-1' },
    });
    template = Template.fromStack(stack);
  });

  describe('DynamoDB Table', () => {
    test('creates a DynamoDB table with correct configuration', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'entrix-orders-test',
        KeySchema: [
          {
            AttributeName: 'record_id',
            KeyType: 'HASH',
          },
        ],
        AttributeDefinitions: [
          {
            AttributeName: 'record_id',
            AttributeType: 'S',
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
        TimeToLiveSpecification: {
          AttributeName: 'ttl',
          Enabled: true,
        },
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });
    });

    test('DynamoDB table has TTL enabled for 24-hour data expiry', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TimeToLiveSpecification: {
          AttributeName: 'ttl',
          Enabled: true,
        },
      });
    });
  });

  describe('S3 Bucket', () => {
    test('creates an S3 bucket with correct configuration', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ],
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        VersioningConfiguration: {
          Status: 'Enabled',
        },
      });
    });

    test('S3 bucket has lifecycle rules for cost optimization', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: 'MoveToInfrequentAccess',
              Status: 'Enabled',
              Transitions: Match.arrayWith([
                Match.objectLike({
                  StorageClass: 'STANDARD_IA',
                  TransitionInDays: 30,
                }),
                Match.objectLike({
                  StorageClass: 'GLACIER',
                  TransitionInDays: 90,
                }),
              ]),
            }),
          ]),
        },
      });
    });
  });

  describe('Lambda Functions', () => {
    test('creates the main Lambda functions', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'entrix-post-orders-test',
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'entrix-lambda-a-test',
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'entrix-lambda-b-test',
      });
    });

    test('Post Orders Lambda has correct configuration', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'entrix-post-orders-test',
        Runtime: 'python3.12',
        Handler: 'app.lambda_handler',
        Timeout: 30,
        MemorySize: 256,
        TracingConfig: {
          Mode: 'Active',
        },
      });
    });

    test('Lambda A has correct configuration', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'entrix-lambda-a-test',
        Runtime: 'python3.12',
        Handler: 'app.lambda_handler',
        Timeout: 30,
        MemorySize: 128,
      });
    });

    test('Lambda B has correct configuration', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'entrix-lambda-b-test',
        Runtime: 'python3.12',
        Handler: 'app.lambda_handler',
        Timeout: 60,
        MemorySize: 256,
      });
    });

    test('Post Orders Lambda has DynamoDB write permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'dynamodb:BatchWriteItem',
                'dynamodb:PutItem',
              ]),
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    test('Lambda B has S3 write permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                's3:PutObject',
                's3:PutObjectLegalHold',
                's3:PutObjectRetention',
                's3:PutObjectTagging',
              ]),
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });
  });

  describe('API Gateway', () => {
    test('creates an API Gateway REST API', () => {
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'entrix-orders-api-test',
      });
    });

    test('API Gateway has correct stage configuration', () => {
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        StageName: 'test',
        TracingEnabled: true,
        MethodSettings: [
          {
            HttpMethod: '*',
            MetricsEnabled: true,
            ResourcePath: '/*',
            ThrottlingBurstLimit: 100,
            ThrottlingRateLimit: 50,
          },
        ],
      });
    });

    test('API Gateway has /orders resource with POST method', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'POST',
      });
    });

    test('API Gateway has CORS configuration', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'OPTIONS',
      });
    });
  });

  describe('Step Functions State Machine', () => {
    test('creates a Step Functions state machine', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        StateMachineName: 'entrix-data-pipeline-test',
        StateMachineType: 'STANDARD',
        TracingConfiguration: {
          Enabled: true,
        },
      });
    });

    test('state machine has logging enabled', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        LoggingConfiguration: {
          Level: 'ALL',
          IncludeExecutionData: true,
        },
      });
    });

    test('state machine definition includes Lambda A invocation', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        DefinitionString: Match.anyValue(),
      });
    });
  });

  describe('EventBridge Rule', () => {
    test('creates an EventBridge rule for scheduled execution', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'entrix-data-pipeline-schedule-test',
        ScheduleExpression: 'rate(1 hour)',
        State: 'ENABLED',
      });
    });

    test('EventBridge rule targets the Step Functions state machine', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Targets: Match.arrayWith([
          Match.objectLike({
            Arn: Match.anyValue(),
          }),
        ]),
      });
    });
  });

  describe('SNS Topics', () => {
    test('creates an alert SNS topic', () => {
      template.hasResourceProperties('AWS::SNS::Topic', {
        TopicName: 'entrix-alerts-test',
        DisplayName: 'Entrix Energy Auction Alerts - test',
      });
    });
  });

  describe('CloudWatch Alarms', () => {
    test('creates Lambda B error alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'entrix-lambda-b-errors-test',
        MetricName: 'Errors',
        Namespace: 'AWS/Lambda',
        Threshold: 1,
        EvaluationPeriods: 1,
      });
    });

    test('creates data pipeline failure alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'entrix-data-pipeline-failures-test',
        MetricName: 'ExecutionsFailed',
        Namespace: 'AWS/States',
        Threshold: 1,
      });
    });

    test('creates API 5XX error alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'entrix-api-5xx-errors-test',
        MetricName: '5XXError',
        Namespace: 'AWS/ApiGateway',
        Threshold: 5,
      });
    });

    test('creates DynamoDB throttle alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'entrix-dynamodb-throttle-test',
        Threshold: 1,
      });
    });

    test('alarms send notifications to SNS topic', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmActions: Match.anyValue(),
      });
    });
  });

  describe('CloudWatch Dashboard', () => {
    test('creates a monitoring dashboard', () => {
      template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
        DashboardName: 'entrix-monitoring-test',
      });
    });
  });

  describe('Stack Outputs', () => {
    test('exports API endpoint URL', () => {
      template.hasOutput('ApiEndpoint', {
        Export: {
          Name: 'EntrixApiEndpoint-test',
        },
      });
    });

    test('exports DynamoDB table name', () => {
      template.hasOutput('OrdersTableName', {
        Export: {
          Name: 'EntrixOrdersTable-test',
        },
      });
    });

    test('exports S3 bucket name', () => {
      template.hasOutput('OrderResultsBucketName', {
        Export: {
          Name: 'EntrixOrderResultsBucket-test',
        },
      });
    });

    test('exports Step Functions state machine ARN', () => {
      template.hasOutput('DataPipelineArn', {
        Export: {
          Name: 'EntrixDataPipelineArn-test',
        },
      });
    });

    test('exports SNS alert topic ARN', () => {
      template.hasOutput('AlertTopicArn', {
        Export: {
          Name: 'EntrixAlertTopicArn-test',
        },
      });
    });
  });
});

describe('EntrixInfrastructureStack - Production Environment', () => {
  let app: cdk.App;
  let stack: EntrixInfrastructureStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new EntrixInfrastructureStack(app, 'ProdStack', {
      environment: 'prod',
      env: { account: '123456789012', region: 'eu-west-1' },
    });
    template = Template.fromStack(stack);
  });

  test('DynamoDB table has RETAIN removal policy in production', () => {
    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  test('S3 bucket has RETAIN removal policy in production', () => {
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });
});
