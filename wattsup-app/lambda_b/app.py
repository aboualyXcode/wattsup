import datetime as dt
import json
import logging
import os
from typing import Any

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

LOG_BUCKET = os.environ['LOG_BUCKET']

# Initialize S3 client
s3_client = boto3.client('s3')


def save_to_s3(data: dict[str, Any], filename: str):
    """Save data to the s3 bucket.

    Parameters
    ----------
    data: dict[str, Any]
        The data to save to s3 bucket.
    filename: str
        The full object name for the file.
    """
    try:
        # Convert data to JSON string
        json_data = json.dumps(data, indent=2, default=str)

        # Upload to S3
        s3_client.put_object(
            Bucket=LOG_BUCKET,
            Key=f'{filename}.json',
            Body=json_data,
            ContentType='application/json',
            ServerSideEncryption='AES256',
        )

        logger.info(f'Successfully saved data to s3://{LOG_BUCKET}/{filename}.json')

    except Exception as e:
        logger.error(f'Failed to save data to S3: {str(e)}')
        raise


def lambda_handler(event, context):
    """Process order result."""
    logger.info(f'Processing order: {json.dumps(event)}')

    if event['status'] == 'rejected':
        raise ValueError('Order status is rejected!')

    save_to_s3(data=event, filename=f'orders/order_{dt.datetime.now(dt.UTC).isoformat()}')

    return {'statusCode': 200, 'message': 'Order processed successfully', 'order': event}
