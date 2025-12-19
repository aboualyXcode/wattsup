import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

export interface EntrixInfrastructureStackProps extends cdk.StackProps {
  environment: string;
}

export class EntrixInfrastructureStack extends cdk.Stack {
  public readonly ordersTable: dynamodb.Table;
  public readonly orderResultsBucket: s3.Bucket;
  public readonly postOrdersLambda: lambda.Function;
  public readonly lambdaA: lambda.Function;
  public readonly lambdaB: lambda.Function;
  public readonly api: apigateway.RestApi;
  public readonly dataPipeline: sfn.StateMachine;
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: EntrixInfrastructureStackProps) {
    super(scope, id, props);

    const { environment } = props;


    // SNS Topic for Alerts (with Slack integration)

    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `entrix-alerts-${environment}`,
      displayName: `Entrix Energy Auction Alerts - ${environment}`,
    });

    // Lambda to forward SNS messages to Slack
    const slackNotifierLogGroup = new logs.LogGroup(this, 'SlackNotifierLogGroup', {
      logGroupName: `/aws/lambda/entrix-slack-notifier-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Reference the Slack webhook secret (must be created manually in Secrets Manager)
    // Create it with: aws secretsmanager create-secret --name entrix/slack-webhook-dev --secret-string "https://hooks.slack.com/services/..."
    const slackWebhookSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'SlackWebhookSecret',
      `entrix/slack-webhook-${environment}`
    );

    const slackNotifier = new lambda.Function(this, 'SlackNotifier', {
      functionName: `entrix-slack-notifier-${environment}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
      import json
      import urllib.request
      import boto3
      import os

      def get_slack_webhook():
          client = boto3.client('secretsmanager')
          response = client.get_secret_value(SecretId=os.environ['SLACK_WEBHOOK_SECRET_NAME'])
          return response['SecretString']

      def handler(event, context):
          slack_webhook = get_slack_webhook()
          
          for record in event.get("Records", []):
              sns_message = record.get("Sns", {})
              subject = sns_message.get("Subject", "Alert")
              message = sns_message.get("Message", "")
              
              try:
                  msg_data = json.loads(message)
                  text = f"*{subject}*\\n" + "\\n".join(f"• {k}: {v}" for k, v in msg_data.items())
              except:
                  text = f"*{subject}*\\n{message}"
              
              payload = json.dumps({"text": text}).encode("utf-8")
              req = urllib.request.Request(slack_webhook, data=payload, headers={"Content-Type": "application/json"})
              urllib.request.urlopen(req)
          
          return {"statusCode": 200}
            `),
      timeout: cdk.Duration.seconds(10),
      logGroup: slackNotifierLogGroup,
      environment: {
        SLACK_WEBHOOK_SECRET_NAME: `entrix/slack-webhook-${environment}`,
      },
    });

    // Grant the Lambda permission to read the secret
    slackWebhookSecret.grantRead(slackNotifier);

    // Subscribe Lambda to SNS topic
    this.alertTopic.addSubscription(new cdk.aws_sns_subscriptions.LambdaSubscription(slackNotifier));

    // Export the topic ARN
    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: this.alertTopic.topicArn,
      description: 'SNS Topic ARN for alerts',
      exportName: `EntrixAlertTopicArn-${environment}`,
    });


    // DynamoDB Table for Orders

    this.ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: `entrix-orders-${environment}`,
      partitionKey: {
        name: 'record_id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl', // Data expires after 24 hours
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: environment === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });


    // S3 Bucket for Order Results

    this.orderResultsBucket = new s3.Bucket(this, 'OrderResultsBucket', {
      bucketName: `order-results-${environment}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: environment === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'prod',
      lifecycleRules: [
        {
          id: 'MoveToInfrequentAccess',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // Lambda Function: POST Orders API Handler
    const postOrdersLogGroup = new logs.LogGroup(this, 'PostOrdersLogGroup', {
      logGroupName: `/aws/lambda/entrix-post-orders-${environment}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.postOrdersLambda = new lambda.Function(this, 'PostOrdersLambda', {
      functionName: `entrix-post-orders-${environment}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../wattsup-app/post_lambda')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.ordersTable.tableName,
        ENVIRONMENT: environment,
      },
      logGroup: postOrdersLogGroup,
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant DynamoDB write permissions
    this.ordersTable.grantWriteData(this.postOrdersLambda);

    // Lambda Function A: Generate Results (Data Pipeline)
    const lambdaALogGroup = new logs.LogGroup(this, 'LambdaALogGroup', {
      logGroupName: `/aws/lambda/entrix-lambda-a-${environment}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.lambdaA = new lambda.Function(this, 'LambdaA', {
      functionName: `entrix-lambda-a-${environment}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../wattsup-app/lambda_a')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      environment: {
        ENVIRONMENT: environment,
      },
      logGroup: lambdaALogGroup,
      tracing: lambda.Tracing.ACTIVE,
    });

    // Lambda Function B: Process Orders (Data Pipeline)
    const lambdaBLogGroup = new logs.LogGroup(this, 'LambdaBLogGroup', {
      logGroupName: `/aws/lambda/entrix-lambda-b-${environment}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.lambdaB = new lambda.Function(this, 'LambdaB', {
      functionName: `entrix-lambda-b-${environment}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../wattsup-app/lambda_b')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        LOG_BUCKET: this.orderResultsBucket.bucketName,
        ENVIRONMENT: environment,
      },
      logGroup: lambdaBLogGroup,
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant S3 write permissions to Lambda B
    this.orderResultsBucket.grantWrite(this.lambdaB);


    // API Gateway for Orders API
    this.api = new apigateway.RestApi(this, 'OrdersApi', {
      restApiName: `entrix-orders-api-${environment}`,
      description: `Entrix Energy Auction Orders API - ${environment}`,
      deployOptions: {
        stageName: environment,
        tracingEnabled: true,
        metricsEnabled: true,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: environment === 'prod' 
          ? ['https://PRODUCTION_DOMAIN.com']  // Restrict in production
          : apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Lambda Authorizer for JWT validation
    const authorizerLogGroup = new logs.LogGroup(this, 'AuthorizerLogGroup', {
      logGroupName: `/aws/lambda/entrix-authorizer-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Reference the JWT secret (must be created manually in Secrets Manager)
    const jwtSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'JwtSecret',
      `entrix/jwt-secret-${environment}`
    );

    const authorizerLambda = new lambda.Function(this, 'AuthorizerLambda', {
      functionName: `entrix-authorizer-${environment}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../wattsup-app/authorizer_lambda'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -r . /asset-output/',
          ],
        },
      }),
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      logGroup: authorizerLogGroup,
      environment: {
        JWT_SECRET_NAME: `entrix/jwt-secret-${environment}`,
      },
    });

    // Grant the authorizer permission to read the JWT secret
    jwtSecret.grantRead(authorizerLambda);

    // Create the API Gateway authorizer
    const authorizer = new apigateway.TokenAuthorizer(this, 'ApiAuthorizer', {
      handler: authorizerLambda,
      authorizerName: `entrix-authorizer-${environment}`,
      resultsCacheTtl: cdk.Duration.minutes(5),
      identitySource: 'method.request.header.Authorization',
    });

    // Add /orders endpoint
    const ordersResource = this.api.root.addResource('orders');
    
    // POST /orders - Create new orders (protected by authorizer)
    ordersResource.addMethod('POST', new apigateway.LambdaIntegration(this.postOrdersLambda, {
      proxy: true,
    }), {
      authorizer: authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      methodResponses: [
        { statusCode: '201' },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' },
        { statusCode: '500' },
      ],
    });

    // Step Functions: Data Pipeline
    this.dataPipeline = this.createDataPipeline(environment);

    // EventBridge Rule: Schedule Data Pipeline
    const scheduleRule = new events.Rule(this, 'DataPipelineSchedule', {
      ruleName: `entrix-data-pipeline-schedule-${environment}`,
      description: 'Triggers the data pipeline on schedule',
      schedule: events.Schedule.rate(cdk.Duration.hours(1)), // Run every hour
      enabled: true,
    });

    scheduleRule.addTarget(new targets.SfnStateMachine(this.dataPipeline));


    // CloudWatch Alarms and Monitoring
    this.setupMonitoring(environment);

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.api.url,
      description: 'Orders API endpoint URL',
      exportName: `EntrixApiEndpoint-${environment}`,
    });

    new cdk.CfnOutput(this, 'OrdersTableName', {
      value: this.ordersTable.tableName,
      description: 'DynamoDB table name for orders',
      exportName: `EntrixOrdersTable-${environment}`,
    });

    new cdk.CfnOutput(this, 'OrderResultsBucketName', {
      value: this.orderResultsBucket.bucketName,
      description: 'S3 bucket for order results',
      exportName: `EntrixOrderResultsBucket-${environment}`,
    });

    new cdk.CfnOutput(this, 'DataPipelineArn', {
      value: this.dataPipeline.stateMachineArn,
      description: 'Step Functions state machine ARN',
      exportName: `EntrixDataPipelineArn-${environment}`,
    });
  }


  private createDataPipeline(environment: string): sfn.StateMachine {
    // Task: Invoke Lambda A
    const invokeLambdaA = new sfnTasks.LambdaInvoke(this, 'InvokeLambdaA', {
      lambdaFunction: this.lambdaA,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // Wait state for retrying Lambda A
    const waitForResults = new sfn.Wait(this, 'WaitForResults', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(30)),
    });

    // Task: Process single order with Lambda B
    const processOrder = new sfnTasks.LambdaInvoke(this, 'ProcessOrder', {
      lambdaFunction: this.lambdaB,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // Task: Send error notification to SNS
    const notifyError = new sfnTasks.SnsPublish(this, 'NotifyError', {
      topic: this.alertTopic,
      message: sfn.TaskInput.fromObject({
        error: 'Lambda B processing failed',
        details: sfn.JsonPath.stringAt('$.error'),
        cause: sfn.JsonPath.stringAt('$.cause'),
        timestamp: sfn.JsonPath.stringAt('$$.State.EnteredTime'),
        executionId: sfn.JsonPath.stringAt('$$.Execution.Id'),
      }),
      subject: `[${environment.toUpperCase()}] Entrix Data Pipeline Error`,
    });

    // Success state for individual order processing
    const orderProcessed = new sfn.Succeed(this, 'OrderProcessed', {
      comment: 'Order successfully processed',
    });

    // Failure state after notification
    const pipelineFailed = new sfn.Fail(this, 'PipelineFailed', {
      error: 'OrderProcessingFailed',
      cause: 'One or more orders failed to process',
    });

    // Success state for entire pipeline
    const pipelineSuccess = new sfn.Succeed(this, 'PipelineSuccess', {
      comment: 'All orders processed successfully',
    });

    // Process order with error handling
    const processOrderWithErrorHandling = processOrder.addCatch(notifyError.next(pipelineFailed), {
      errors: ['States.ALL'],
      resultPath: '$.error',
    }).next(orderProcessed);

    // Map state to process all orders in parallel
    const processAllOrders = new sfn.Map(this, 'ProcessAllOrders', {
      maxConcurrency: 5,
      itemsPath: '$.orders',
      resultPath: '$.processedOrders',
    });
    processAllOrders.itemProcessor(processOrderWithErrorHandling);

    // Choice: Check if results are ready
    const checkResults = new sfn.Choice(this, 'CheckResultsReady')
      .when(
        sfn.Condition.booleanEquals('$.results', false),
        waitForResults.next(invokeLambdaA)
      )
      .otherwise(processAllOrders.next(pipelineSuccess));

    // Build the state machine definition
    const definition = invokeLambdaA.next(checkResults);

    // Create the state machine with logging
    const logGroup = new logs.LogGroup(this, 'DataPipelineLogGroup', {
      logGroupName: `/aws/stepfunctions/entrix-data-pipeline-${environment}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: environment === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    return new sfn.StateMachine(this, 'DataPipeline', {
      stateMachineName: `entrix-data-pipeline-${environment}`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      tracingEnabled: true,
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.hours(1),
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
    });
  }

  // Sets up CloudWatch alarms and monitoring dashboards.
  private setupMonitoring(environment: string): void {
    // Create CloudWatch Dashboard
    const dashboard = new cdk.aws_cloudwatch.Dashboard(this, 'MonitoringDashboard', {
      dashboardName: `entrix-monitoring-${environment}`,
    });

    // Lambda error rate alarms
    const lambdaBErrorAlarm = this.lambdaB.metricErrors({
      period: cdk.Duration.minutes(5),
    }).createAlarm(this, 'LambdaBErrorAlarm', {
      alarmName: `entrix-lambda-b-errors-${environment}`,
      alarmDescription: 'Lambda B error rate exceeded threshold',
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Add alarm action to SNS topic
    lambdaBErrorAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alertTopic));

    // Step Functions execution failure alarm
    const sfnFailureAlarm = this.dataPipeline.metricFailed({
      period: cdk.Duration.minutes(5),
    }).createAlarm(this, 'DataPipelineFailureAlarm', {
      alarmName: `entrix-data-pipeline-failures-${environment}`,
      alarmDescription: 'Data pipeline execution failed',
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    sfnFailureAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alertTopic));

    // API Gateway 5XX errors alarm
    const api5xxAlarm = this.api.metricServerError({
      period: cdk.Duration.minutes(5),
    }).createAlarm(this, 'Api5xxErrorAlarm', {
      alarmName: `entrix-api-5xx-errors-${environment}`,
      alarmDescription: 'API Gateway 5XX error rate exceeded threshold',
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    api5xxAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alertTopic));

    // DynamoDB throttling alarm
    const dynamoThrottleMetric = new cdk.aws_cloudwatch.Metric({
      namespace: 'AWS/DynamoDB',
      metricName: 'ThrottledRequests',
      dimensionsMap: { TableName: this.ordersTable.tableName },
      period: cdk.Duration.minutes(5),
    });
    const dynamoThrottleAlarm = dynamoThrottleMetric.createAlarm(this, 'DynamoThrottleAlarm', {
      alarmName: `entrix-dynamodb-throttle-${environment}`,
      alarmDescription: 'DynamoDB requests are being throttled',
      threshold: 1,
      evaluationPeriods: 2,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    dynamoThrottleAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alertTopic));

    // Add widgets to dashboard
    dashboard.addWidgets(
      new cdk.aws_cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: [
          this.postOrdersLambda.metricInvocations(),
          this.lambdaA.metricInvocations(),
          this.lambdaB.metricInvocations(),
        ],
        width: 12,
      }),
      new cdk.aws_cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [
          this.postOrdersLambda.metricErrors(),
          this.lambdaA.metricErrors(),
          this.lambdaB.metricErrors(),
        ],
        width: 12,
      }),
      new cdk.aws_cloudwatch.GraphWidget({
        title: 'API Gateway Requests',
        left: [
          this.api.metricCount(),
          this.api.metricServerError(),
          this.api.metricClientError(),
        ],
        width: 12,
      }),
      new cdk.aws_cloudwatch.GraphWidget({
        title: 'Data Pipeline Executions',
        left: [
          this.dataPipeline.metricStarted(),
          this.dataPipeline.metricSucceeded(),
          this.dataPipeline.metricFailed(),
        ],
        width: 12,
      }),
    );
  }
}
