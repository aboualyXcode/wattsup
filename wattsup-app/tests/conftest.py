"""Shared fixtures for tests."""

import json
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def mock_s3_client():
    client = MagicMock()
    client.put_object.return_value = {'ResponseMetadata': {'HTTPStatusCode': 200}}
    return client


@pytest.fixture
def mock_dynamodb_table():
    table = MagicMock()
    batch = MagicMock()
    batch.__enter__ = MagicMock(return_value=batch)
    batch.__exit__ = MagicMock(return_value=False)
    table.batch_writer.return_value = batch
    return table


@pytest.fixture
def sample_order():
    return {'status': 'accepted', 'power': 100, 'price': 50.25}


@pytest.fixture
def sample_rejected_order():
    return {'status': 'rejected', 'power': 200, 'price': 45.50}


@pytest.fixture
def sample_api_event():
    return {
        'httpMethod': 'POST',
        'path': '/orders',
        'body': json.dumps(
            [
                {'record_id': 'order-001', 'status': 'pending', 'power': 100},
                {'record_id': 'order-002', 'status': 'pending', 'power': 200},
            ]
        ),
    }


@pytest.fixture
def sample_api_event_empty_body():
    return {'httpMethod': 'POST', 'path': '/orders', 'body': None}


@pytest.fixture
def sample_api_event_invalid_json():
    return {'httpMethod': 'POST', 'path': '/orders', 'body': 'not valid json'}


@pytest.fixture
def sample_api_event_not_list():
    return {'httpMethod': 'POST', 'path': '/orders', 'body': json.dumps({'record_id': 'single'})}


@pytest.fixture
def sample_api_event_missing_record_id():
    return {'httpMethod': 'POST', 'path': '/orders', 'body': json.dumps([{'status': 'pending'}])}


@pytest.fixture
def lambda_context():
    ctx = MagicMock()
    ctx.function_name = 'test-function'
    ctx.aws_request_id = 'test-request-id'
    return ctx
