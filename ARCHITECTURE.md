# WattsUp AWS Architecture

> Serverless Energy Auction System - Infrastructure Stack + Pipeline Stack

## Architecture Diagram

```mermaid
flowchart TB
    subgraph API["📡 API Flow (User-Initiated)"]
        Client["👤 Client"]
        APIGW["🌐 API Gateway<br/>/orders endpoint"]
        Auth["λ Authorizer<br/>JWT validation"]
        PostLambda["λ Post Orders<br/>API handler"]
        DynamoDB[("📊 DynamoDB<br/>Orders table<br/>TTL: 24h")]
        JWTSecret["🔐 Secrets Manager<br/>JWT secret"]
        
        Client -->|HTTPS| APIGW
        APIGW -->|validate| Auth
        Auth -.->|read| JWTSecret
        APIGW -->|invoke| PostLambda
        PostLambda -->|write| DynamoDB
    end

    subgraph Pipeline["⚡ Data Pipeline (Scheduled)"]
        EventBridge["📅 EventBridge<br/>rate(1 hour)"]
        StepFn["⚙️ Step Functions<br/>Data Pipeline"]
        LambdaA["λ Lambda A<br/>Check results"]
        LambdaB["λ Lambda B<br/>Process order"]
        LambdaBParallel["λ Lambda B ×5<br/>Parallel processing"]
        S3[("🪣 S3 Bucket<br/>Order results")]
        
        EventBridge -->|trigger| StepFn
        StepFn -->|invoke| LambdaA
        LambdaA -->|"results?"| StepFn
        StepFn -->|"if results"| LambdaB
        LambdaB -->|save| S3
        StepFn -->|"Map state"| LambdaBParallel
        LambdaBParallel -->|save| S3
        LambdaA -.->|"wait 30s<br/>(if no results)"| LambdaA
    end

    subgraph Alerting["🔔 Alerting & Monitoring"]
        SNS["📢 SNS Topic<br/>Alerts"]
        SlackLambda["λ Slack Lambda<br/>Notifier"]
        Slack["💬 Slack<br/>Webhook"]
        CWAlarms["📈 CloudWatch<br/>Alarms (4)"]
        Dashboard["📊 Dashboard<br/>Monitoring"]
        SlackSecret["🔐 Secrets Manager<br/>Slack webhook"]
        
        CWAlarms -->|notify| SNS
        SNS -->|trigger| SlackLambda
        SlackLambda -->|post| Slack
        SlackLambda -.->|read| SlackSecret
    end

    subgraph CICD["🚀 CI/CD Pipeline"]
        GitHub["🐙 GitHub<br/>Source repo"]
        CodePipeline["🔄 CodePipeline<br/>3-stage"]
        BuildProject["🔨 CodeBuild<br/>Build & Synth"]
        DeployProject["🚀 CodeBuild<br/>Deploy"]
        
        GitHub -->|webhook| CodePipeline
        CodePipeline -->|Source| BuildProject
        BuildProject -->|Build| DeployProject
    end

    %% Cross-subgraph connections
    StepFn -->|"on error"| SNS
    DeployProject -.->|"deploys"| API
    DeployProject -.->|"deploys"| Pipeline
    DeployProject -.->|"deploys"| Alerting

    %% Styling
    classDef lambda fill:#FFF3E0,stroke:#FF9900,stroke-width:2px
    classDef storage fill:#E8EAF6,stroke:#4053D6,stroke-width:2px
    classDef s3 fill:#E8F5E9,stroke:#569A31,stroke-width:2px
    classDef apigateway fill:#FCE4EC,stroke:#E7157B,stroke-width:2px
    classDef events fill:#FCE4EC,stroke:#FF4F8B,stroke-width:2px
    classDef secrets fill:#FFEBEE,stroke:#DD344C,stroke-width:2px
    classDef external fill:#ECEFF1,stroke:#232F3E,stroke-width:2px
    classDef slack fill:#F3E5F5,stroke:#4A154B,stroke-width:2px
    classDef cicd fill:#E8EAF6,stroke:#4053D6,stroke-width:2px

    class Auth,PostLambda,LambdaA,LambdaB,LambdaBParallel,SlackLambda lambda
    class DynamoDB storage
    class S3 s3
    class APIGW apigateway
    class EventBridge,StepFn,SNS,CWAlarms,Dashboard events
    class JWTSecret,SlackSecret secrets
    class Client,GitHub external
    class Slack slack
    class CodePipeline,BuildProject,DeployProject cicd
```

## Component Summary

### 📡 API Flow (User-Initiated)
| Component | Purpose |
|-----------|---------|
| API Gateway | REST API with `/orders` endpoint, throttling (50 req/s), CORS |
| Authorizer Lambda | JWT validation using HS256, 5-min cache |
| Post Orders Lambda | Validates input, writes to DynamoDB with 24h TTL |
| DynamoDB | Orders table, PAY_PER_REQUEST, Point-in-Time Recovery |

### ⚡ Data Pipeline (Scheduled)
| Component | Purpose |
|-----------|---------|
| EventBridge | Triggers pipeline every hour |
| Step Functions | Orchestrates workflow, 1h timeout, full logging |
| Lambda A | Checks if results are ready, returns `{results: true/false}` |
| Lambda B | Processes orders, saves to S3, max 5 parallel |
| S3 Bucket | Stores results, lifecycle: IA@30d, Glacier@90d |

### 🔔 Alerting & Monitoring
| Component | Purpose |
|-----------|---------|
| CloudWatch Alarms | Lambda errors, Pipeline failures, API 5XX, DynamoDB throttling |
| SNS Topic | Central alert hub |
| Slack Lambda | Forwards alerts to Slack |
| Dashboard | 4 widgets: invocations, errors, API requests, pipeline executions |

### 🚀 CI/CD Pipeline
| Component | Purpose |
|-----------|---------|
| GitHub | Source repository via CodeStar Connection |
| CodePipeline | 3 stages: Source → Build → Deploy |
| CodeBuild (Build) | TypeScript compilation, CDK synthesis |
| CodeBuild (Deploy) | Executes `cdk deploy`, scoped IAM permissions |

## Data Flows

```mermaid
flowchart LR
    subgraph api_flow["API Flow"]
        A1[Client] --> A2[API GW] --> A3[Auth] --> A4[Lambda] --> A5[DynamoDB]
    end
    
    subgraph pipeline_flow["Pipeline Flow"]
        P1[EventBridge] --> P2[Step Fn] --> P3[Lambda A]
        P3 -->|results| P4[Lambda B] --> P5[S3]
        P3 -.->|no results| P3
    end
    
    subgraph error_flow["Error Flow"]
        E1[Step Fn Error] --> E2[SNS] --> E3[Slack Lambda] --> E4[Slack]
    end
```

## Quick Reference

- **Runtime**: Python 3.12 (all Lambdas)
- **Region**: eu-west-1
- **Environments**: dev, staging, prod
- **Removal Policy**: RETAIN (prod), DESTROY (others)
