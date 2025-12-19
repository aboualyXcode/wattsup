"""Tests for lambda_b module."""

import importlib
import json
import os
import sys
from unittest.mock import patch

import pytest

os.environ['LOG_BUCKET'] = 'test-log-bucket'


def reload_module(mock_s3=None):
    """Helper to reload lambda_b.app with fresh mocks."""
    if 'lambda_b.app' in sys.modules:
        del sys.modules['lambda_b.app']
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lambda_b'))
    import lambda_b.app

    importlib.reload(lambda_b.app)
    return lambda_b.app


class TestLambdaBSaveToS3:
    @pytest.mark.unit
    def test_save_to_s3_success(self, mock_s3_client):
        with patch.dict(os.environ, {'LOG_BUCKET': 'test-bucket'}):
            with patch('boto3.client', return_value=mock_s3_client):
                mod = reload_module()
                mod.save_to_s3({'test': 'data', 'value': 123}, 'test/filename')

                mock_s3_client.put_object.assert_called_once()
                call_kwargs = mock_s3_client.put_object.call_args[1]
                assert call_kwargs['Bucket'] == 'test-bucket'
                assert call_kwargs['Key'] == 'test/filename.json'
                assert call_kwargs['ContentType'] == 'application/json'
                assert call_kwargs['ServerSideEncryption'] == 'AES256'

    @pytest.mark.unit
    def test_save_to_s3_serializes_json(self, mock_s3_client):
        with patch.dict(os.environ, {'LOG_BUCKET': 'test-bucket'}):
            with patch('boto3.client', return_value=mock_s3_client):
                mod = reload_module()
                data = {'status': 'accepted', 'power': 100}
                mod.save_to_s3(data, 'orders/test')

                call_kwargs = mock_s3_client.put_object.call_args[1]
                body = call_kwargs['Body']
                parsed = json.loads(body)
                assert parsed == data

    @pytest.mark.unit
    def test_save_to_s3_raises_on_error(self, mock_s3_client):
        mock_s3_client.put_object.side_effect = Exception('S3 error')
        with patch.dict(os.environ, {'LOG_BUCKET': 'test-bucket'}):
            with patch('boto3.client', return_value=mock_s3_client):
                mod = reload_module()
                with pytest.raises(Exception, match='S3 error'):
                    mod.save_to_s3({'test': 'data'}, 'test/file')


class TestLambdaBHandler:
    @pytest.mark.unit
    def test_lambda_handler_accepts_order(self, mock_s3_client, lambda_context, sample_order):
        with patch.dict(os.environ, {'LOG_BUCKET': 'test-bucket'}):
            with patch('boto3.client', return_value=mock_s3_client):
                mod = reload_module()
                result = mod.lambda_handler(sample_order, lambda_context)

                assert result['statusCode'] == 200
                assert result['message'] == 'Order processed successfully'
                assert result['order'] == sample_order
                mock_s3_client.put_object.assert_called_once()

    @pytest.mark.unit
    def test_lambda_handler_rejects_order(self, mock_s3_client, lambda_context, sample_rejected_order):
        with patch.dict(os.environ, {'LOG_BUCKET': 'test-bucket'}):
            with patch('boto3.client', return_value=mock_s3_client):
                mod = reload_module()
                with pytest.raises(ValueError, match='Order status is rejected!'):
                    mod.lambda_handler(sample_rejected_order, lambda_context)

    @pytest.mark.unit
    def test_lambda_handler_saves_to_correct_path(self, mock_s3_client, lambda_context, sample_order):
        with patch.dict(os.environ, {'LOG_BUCKET': 'test-bucket'}):
            with patch('boto3.client', return_value=mock_s3_client):
                mod = reload_module()
                mod.lambda_handler(sample_order, lambda_context)

                call_kwargs = mock_s3_client.put_object.call_args[1]
                assert call_kwargs['Key'].startswith('orders/order_')
                assert call_kwargs['Key'].endswith('.json')

    @pytest.mark.unit
    def test_lambda_handler_includes_order_in_response(self, mock_s3_client, lambda_context):
        event = {'status': 'accepted', 'power': 500, 'custom_field': 'value'}
        with patch.dict(os.environ, {'LOG_BUCKET': 'test-bucket'}):
            with patch('boto3.client', return_value=mock_s3_client):
                mod = reload_module()
                result = mod.lambda_handler(event, lambda_context)

                assert result['order'] == event
                assert result['order']['custom_field'] == 'value'
