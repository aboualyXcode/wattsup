"""Tests for lambda_a module."""

import os
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lambda_a'))
from lambda_a.app import lambda_handler


class TestLambdaA:
    @pytest.mark.unit
    def test_returns_dict(self, lambda_context):
        result = lambda_handler({}, lambda_context)
        assert isinstance(result, dict)

    @pytest.mark.unit
    def test_has_results_key(self, lambda_context):
        result = lambda_handler({}, lambda_context)
        assert 'results' in result

    @pytest.mark.unit
    def test_results_is_boolean(self, lambda_context):
        result = lambda_handler({}, lambda_context)
        assert isinstance(result['results'], bool)

    @pytest.mark.unit
    @patch('lambda_a.app.random.choice')
    def test_with_results_true(self, mock_choice, lambda_context):
        mock_choice.return_value = True
        result = lambda_handler({}, lambda_context)

        assert result['results'] is True
        assert 'orders' in result
        assert isinstance(result['orders'], list)

    @pytest.mark.unit
    @patch('lambda_a.app.random.choice')
    def test_with_results_false(self, mock_choice, lambda_context):
        mock_choice.return_value = False
        result = lambda_handler({}, lambda_context)

        assert result['results'] is False
        assert 'orders' not in result

    @pytest.mark.unit
    @patch('lambda_a.app.random.choice')
    def test_orders_structure(self, mock_choice, lambda_context):
        mock_choice.return_value = True
        result = lambda_handler({}, lambda_context)

        assert len(result['orders']) == 2
        assert result['orders'][0]['status'] == 'accepted'
        assert result['orders'][0]['power'] == 1
        assert result['orders'][1]['status'] == 'rejected'
        assert result['orders'][1]['power'] == 2

    @pytest.mark.unit
    def test_ignores_input_event(self, lambda_context):
        result1 = lambda_handler({'key': 'value'}, lambda_context)
        result2 = lambda_handler(None, lambda_context)
        result3 = lambda_handler([], lambda_context)

        assert 'results' in result1
        assert 'results' in result2
        assert 'results' in result3
