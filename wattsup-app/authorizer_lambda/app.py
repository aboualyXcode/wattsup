"""
Lambda Authorizer for API Gateway.
Validates JWT tokens from the Authorization header.
"""

import os

import boto3
import jwt

# Cache for secret key
_cached_secret = None


def get_secret_key():
    """Get secret key from Secrets Manager (cached)."""
    global _cached_secret
    if _cached_secret is not None:
        return _cached_secret

    secret_name = os.environ.get('JWT_SECRET_NAME')
    if not secret_name:
        raise ValueError('JWT_SECRET_NAME environment variable not set')

    client = boto3.client('secretsmanager')
    response = client.get_secret_value(SecretId=secret_name)
    _cached_secret = response['SecretString']
    return _cached_secret


def validate_token(token: str) -> dict:
    """Validate JWT token and return claims."""
    secret_key = get_secret_key()

    return jwt.decode(
        token,
        secret_key,
        algorithms=['HS256'],
    )


def generate_policy(principal_id: str, effect: str, resource: str, context: dict = None) -> dict:
    """Generate IAM policy document for API Gateway."""
    policy = {
        'principalId': principal_id,
        'policyDocument': {
            'Version': '2012-10-17',
            'Statement': [
                {
                    'Action': 'execute-api:Invoke',
                    'Effect': effect,
                    'Resource': resource,
                }
            ],
        },
    }

    if context:
        policy['context'] = context

    return policy


def lambda_handler(event, context):
    """
    Lambda Authorizer handler.

    Expected event format (TOKEN type):
    {
        "type": "TOKEN",
        "authorizationToken": "Bearer <token>",
        "methodArn": "arn:aws:execute-api:..."
    }
    """
    try:
        auth_token = event.get('authorizationToken', '')
        method_arn = event.get('methodArn', '*')

        if not auth_token:
            raise ValueError('No authorization token provided')

        # Remove 'Bearer ' prefix if present
        if auth_token.lower().startswith('bearer '):
            token = auth_token[7:]
        else:
            token = auth_token

        # Validate token
        claims = validate_token(token)

        # Extract user identifier
        principal_id = claims.get('sub', claims.get('email', 'user'))

        # Build context to pass to downstream Lambda
        auth_context = {
            'userId': principal_id,
            'email': claims.get('email', ''),
        }

        return generate_policy(principal_id, 'Allow', method_arn, auth_context)

    except jwt.ExpiredSignatureError:
        print('Token expired')
        raise Exception('Unauthorized') from None
    except jwt.InvalidTokenError as e:
        print(f'Invalid token: {e}')
        raise Exception('Unauthorized') from None
    except Exception as e:
        print(f'Authorization error: {e}')
        raise Exception('Unauthorized') from None
