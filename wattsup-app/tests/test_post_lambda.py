"""Tests for post_lambda module."""

import importlib
import json
import os
import sys
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

os.environ['TABLE_NAME'] = 'test-orders-table'


def reload_module():
    """Helper to reload post_lambda.app with fresh mocks."""
    if 'post_lambda.app' in sys.modules:
        del sys.modules['post_lambda.app']
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'post_lambda'))
    import post_lambda.app

    importlib.reload(post_lambda.app)
    return post_lambda.app


class TestConvertFloatsToDecimal:
    @pytest.mark.unit
    def test_convert_float(self):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            mod = reload_module()
            assert mod.convert_floats_to_decimal(3.14) == Decimal('3.14')

    @pytest.mark.unit
    def test_convert_dict_with_floats(self):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            mod = reload_module()
            data = {'price': 50.25, 'quantity': 10}
            result = mod.convert_floats_to_decimal(data)
            assert result['price'] == Decimal('50.25')
            assert result['quantity'] == 10

    @pytest.mark.unit
    def test_convert_nested_dict(self):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            mod = reload_module()
            data = {'order': {'price': 99.99, 'nested': {'value': 1.5}}}
            result = mod.convert_floats_to_decimal(data)
            assert result['order']['price'] == Decimal('99.99')
            assert result['order']['nested']['value'] == Decimal('1.5')

    @pytest.mark.unit
    def test_convert_list_with_floats(self):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            mod = reload_module()
            result = mod.convert_floats_to_decimal([1.1, 2.2, 3.3])
            assert result == [Decimal('1.1'), Decimal('2.2'), Decimal('3.3')]

    @pytest.mark.unit
    def test_convert_preserves_strings(self):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            mod = reload_module()
            data = {'name': 'test', 'status': 'active'}
            result = mod.convert_floats_to_decimal(data)
            assert result['name'] == 'test'
            assert result['status'] == 'active'

    @pytest.mark.unit
    def test_convert_preserves_integers(self):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            mod = reload_module()
            data = {'count': 42, 'power': 100}
            result = mod.convert_floats_to_decimal(data)
            assert result['count'] == 42
            assert result['power'] == 100


class TestSaveToDb:
    @pytest.mark.unit
    def test_save_to_db_success(self, mock_dynamodb_table):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            with patch('boto3.resource') as mock_resource:
                mock_dynamodb = MagicMock()
                mock_dynamodb.Table.return_value = mock_dynamodb_table
                mock_resource.return_value = mock_dynamodb

                mod = reload_module()
                records = [
                    {'record_id': 'rec-001', 'data': 'value1'},
                    {'record_id': 'rec-002', 'data': 'value2'},
                ]
                mod.save_to_db(records)
                mock_dynamodb_table.batch_writer.assert_called_once()

    @pytest.mark.unit
    def test_save_to_db_adds_ttl(self, mock_dynamodb_table):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            with patch('boto3.resource') as mock_resource:
                mock_dynamodb = MagicMock()
                mock_batch = MagicMock()
                mock_batch.__enter__ = MagicMock(return_value=mock_batch)
                mock_batch.__exit__ = MagicMock(return_value=False)
                mock_dynamodb_table.batch_writer.return_value = mock_batch
                mock_dynamodb.Table.return_value = mock_dynamodb_table
                mock_resource.return_value = mock_dynamodb

                mod = reload_module()
                mod.save_to_db([{'record_id': 'rec-001'}])

                call_args = mock_batch.put_item.call_args
                assert 'ttl' in call_args[1]['Item']
                assert 'created_at' in call_args[1]['Item']


class TestPostLambdaHandler:
    @pytest.mark.unit
    def test_handler_success(self, sample_api_event, lambda_context, mock_dynamodb_table):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            with patch('boto3.resource') as mock_resource:
                mock_dynamodb = MagicMock()
                mock_batch = MagicMock()
                mock_batch.__enter__ = MagicMock(return_value=mock_batch)
                mock_batch.__exit__ = MagicMock(return_value=False)
                mock_dynamodb_table.batch_writer.return_value = mock_batch
                mock_dynamodb.Table.return_value = mock_dynamodb_table
                mock_resource.return_value = mock_dynamodb

                mod = reload_module()
                result = mod.lambda_handler(sample_api_event, lambda_context)

                assert result['statusCode'] == 201
                body = json.loads(result['body'])
                assert body['count'] == 2
                assert 'Successfully saved' in body['message']

    @pytest.mark.unit
    def test_handler_empty_body(self, sample_api_event_empty_body, lambda_context):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            with patch('boto3.resource'):
                mod = reload_module()
                result = mod.lambda_handler(sample_api_event_empty_body, lambda_context)

                assert result['statusCode'] == 400
                body = json.loads(result['body'])
                assert 'empty' in body['errorMessage'].lower()

    @pytest.mark.unit
    def test_handler_invalid_json(self, sample_api_event_invalid_json, lambda_context):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            with patch('boto3.resource'):
                mod = reload_module()
                result = mod.lambda_handler(sample_api_event_invalid_json, lambda_context)

                assert result['statusCode'] == 400
                body = json.loads(result['body'])
                assert 'Invalid JSON' in body['errorMessage']

    @pytest.mark.unit
    def test_handler_non_list_body(self, sample_api_event_not_list, lambda_context):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            with patch('boto3.resource'):
                mod = reload_module()
                result = mod.lambda_handler(sample_api_event_not_list, lambda_context)

                assert result['statusCode'] == 400
                body = json.loads(result['body'])
                assert 'list' in body['errorMessage'].lower()

    @pytest.mark.unit
    def test_handler_missing_record_id(self, sample_api_event_missing_record_id, lambda_context):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            with patch('boto3.resource'):
                mod = reload_module()
                result = mod.lambda_handler(sample_api_event_missing_record_id, lambda_context)

                assert result['statusCode'] == 400
                body = json.loads(result['body'])
                assert 'record_id' in body['errorMessage']

    @pytest.mark.unit
    def test_handler_response_headers(self, sample_api_event, lambda_context, mock_dynamodb_table):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            with patch('boto3.resource') as mock_resource:
                mock_dynamodb = MagicMock()
                mock_batch = MagicMock()
                mock_batch.__enter__ = MagicMock(return_value=mock_batch)
                mock_batch.__exit__ = MagicMock(return_value=False)
                mock_dynamodb_table.batch_writer.return_value = mock_batch
                mock_dynamodb.Table.return_value = mock_dynamodb_table
                mock_resource.return_value = mock_dynamodb

                mod = reload_module()
                result = mod.lambda_handler(sample_api_event, lambda_context)

                assert result['headers']['Content-Type'] == 'application/json'
                assert result['isBase64Encoded'] is False

    @pytest.mark.unit
    def test_handler_internal_error(self, sample_api_event, lambda_context):
        with patch.dict(os.environ, {'TABLE_NAME': 'test-table'}):
            with patch('boto3.resource') as mock_resource:
                mock_dynamodb = MagicMock()
                mock_table = MagicMock()
                mock_table.batch_writer.side_effect = Exception('DynamoDB error')
                mock_dynamodb.Table.return_value = mock_table
                mock_resource.return_value = mock_dynamodb

                mod = reload_module()
                result = mod.lambda_handler(sample_api_event, lambda_context)

                assert result['statusCode'] == 500
                body = json.loads(result['body'])
                assert 'Internal server error' in body['errorMessage']
