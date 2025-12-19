"""Tests for the Lambda Authorizer."""

from unittest.mock import patch

import jwt
import pytest


class TestAuthorizerLambda:
    """Tests for authorizer lambda handler."""

    @pytest.fixture
    def mock_env(self, monkeypatch):
        """Set up environment variables."""
        monkeypatch.setenv('JWT_SECRET_NAME', 'test-secret')

    @pytest.fixture
    def valid_token(self):
        """Generate a valid JWT token."""
        return jwt.encode({'sub': 'user123', 'email': 'test@example.com'}, 'test-secret-key', algorithm='HS256')

    @pytest.fixture
    def expired_token(self):
        """Generate an expired JWT token."""
        import time

        return jwt.encode({'sub': 'user123', 'exp': int(time.time()) - 3600}, 'test-secret-key', algorithm='HS256')

    @patch('authorizer_lambda.app.get_secret_key')
    def test_valid_token_allows_access(self, mock_get_secret, mock_env, valid_token):
        """Test that a valid token allows access."""
        mock_get_secret.return_value = 'test-secret-key'

        from authorizer_lambda.app import lambda_handler

        event = {
            'type': 'TOKEN',
            'authorizationToken': f'Bearer {valid_token}',
            'methodArn': 'arn:aws:execute-api:eu-west-1:123456789:api/dev/POST/orders',
        }

        result = lambda_handler(event, None)

        assert result['principalId'] == 'user123'
        assert result['policyDocument']['Statement'][0]['Effect'] == 'Allow'

    @patch('authorizer_lambda.app.get_secret_key')
    def test_expired_token_denies_access(self, mock_get_secret, mock_env, expired_token):
        """Test that an expired token denies access."""
        mock_get_secret.return_value = 'test-secret-key'

        from authorizer_lambda.app import lambda_handler

        event = {
            'type': 'TOKEN',
            'authorizationToken': f'Bearer {expired_token}',
            'methodArn': 'arn:aws:execute-api:eu-west-1:123456789:api/dev/POST/orders',
        }

        with pytest.raises(Exception, match='Unauthorized'):
            lambda_handler(event, None)

    def test_missing_token_denies_access(self, mock_env):
        """Test that missing token denies access."""
        from authorizer_lambda.app import lambda_handler

        event = {
            'type': 'TOKEN',
            'authorizationToken': '',
            'methodArn': 'arn:aws:execute-api:eu-west-1:123456789:api/dev/POST/orders',
        }

        with pytest.raises(Exception, match='Unauthorized'):
            lambda_handler(event, None)

    @patch('authorizer_lambda.app.get_secret_key')
    def test_invalid_token_denies_access(self, mock_get_secret, mock_env):
        """Test that an invalid token denies access."""
        mock_get_secret.return_value = 'test-secret-key'

        from authorizer_lambda.app import lambda_handler

        event = {
            'type': 'TOKEN',
            'authorizationToken': 'Bearer invalid.token.here',
            'methodArn': 'arn:aws:execute-api:eu-west-1:123456789:api/dev/POST/orders',
        }

        with pytest.raises(Exception, match='Unauthorized'):
            lambda_handler(event, None)

    @patch('authorizer_lambda.app.get_secret_key')
    def test_token_without_bearer_prefix(self, mock_get_secret, mock_env, valid_token):
        """Test that token without Bearer prefix still works."""
        mock_get_secret.return_value = 'test-secret-key'

        from authorizer_lambda.app import lambda_handler

        event = {
            'type': 'TOKEN',
            'authorizationToken': valid_token,
            'methodArn': 'arn:aws:execute-api:eu-west-1:123456789:api/dev/POST/orders',
        }

        result = lambda_handler(event, None)

        assert result['principalId'] == 'user123'
        assert result['policyDocument']['Statement'][0]['Effect'] == 'Allow'
