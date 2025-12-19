import json
import logging
import os
import time
from decimal import Decimal
from typing import Any

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ['TABLE_NAME']

# Initialize DynamoDB resource
dynamodb = boto3.resource('dynamodb', region_name=os.environ.get('AWS_REGION', 'eu-west-1'))
table = dynamodb.Table(TABLE_NAME)

# TTL: 24 hours in seconds
TTL_SECONDS = 24 * 60 * 60


def save_to_db(records: list[dict[str, Any]]):
    """Save records to the table.

    Parameters
    ----------
    records: list[dict[str, Any]]
        The data to save to Table.
    """
    try:
        # Calculate TTL timestamp (24 hours from now)
        ttl_timestamp = int(time.time()) + TTL_SECONDS

        # Use batch writer for efficient writes
        with table.batch_writer() as batch:
            for record in records:
                # Add TTL attribute for automatic expiration
                item = {
                    **record,
                    'ttl': ttl_timestamp,
                    'created_at': int(time.time()),
                }

                # Convert floats to Decimal for DynamoDB compatibility
                item = convert_floats_to_decimal(item)

                batch.put_item(Item=item)

        logger.info('Records are successfully saved to the DB table %s.', TABLE_NAME)

    except Exception as e:
        logger.error(f'Failed to save records to DynamoDB: {str(e)}')
        raise


def convert_floats_to_decimal(obj):
    """Convert float values to Decimal for DynamoDB compatibility."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: convert_floats_to_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_floats_to_decimal(i) for i in obj]
    return obj


def lambda_handler(event, context):
    """Process POST request to the API."""
    logger.info('Received %s request to %s endpoint', event['httpMethod'], event['path'])

    try:
        # Parse the body if it's a string
        body = event.get('body')
        if body is None:
            return {
                'isBase64Encoded': False,
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'errorMessage': 'Request body is empty'}),
            }

        # Parse JSON if body is string
        if isinstance(body, str):
            orders = json.loads(body)
        else:
            orders = body

        logger.info('Orders received: %s.', orders)

        # Validate that orders is a list
        if not isinstance(orders, list):
            return {
                'isBase64Encoded': False,
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'errorMessage': 'Request body must be a list of orders'}),
            }

        # Validate each order has required fields
        for order in orders:
            if 'record_id' not in order:
                return {
                    'isBase64Encoded': False,
                    'statusCode': 400,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({'errorMessage': "Each order must have a 'record_id' field"}),
                }

        save_to_db(records=orders)

        return {
            'isBase64Encoded': False,
            'statusCode': 201,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'message': f'Successfully saved {len(orders)} orders', 'count': len(orders)}),
        }

    except json.JSONDecodeError as e:
        logger.error(f'Invalid JSON in request body: {str(e)}')
        return {
            'isBase64Encoded': False,
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'errorMessage': f'Invalid JSON: {str(e)}'}),
        }
    except Exception as e:
        logger.error(f'Error processing request: {str(e)}')
        return {
            'isBase64Encoded': False,
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'errorMessage': f'Internal server error: {str(e)}'}),
        }
