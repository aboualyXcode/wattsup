.PHONY: install lint-python test-python format-python lint-node test-node format-node deploy-pipeline deploy-infra clean

ENVIRONMENT ?= dev

install-python:
	python3 -m venv .venv
	.venv/bin/pip install -U pip
	.venv/bin/pip install -r wattsup-app/requirements-dev.txt

install-node:
	cd cloud-infra && npm install

lint-python: install-python
	cd wattsup-app && ../.venv/bin/ruff check .
	cd wattsup-app && ../.venv/bin/ruff format --check .

format-python: install-python
	cd wattsup-app && ../.venv/bin/ruff check --fix .
	cd wattsup-app && ../.venv/bin/ruff format .

test-python: install-python
	cd wattsup-app && PYTHONPATH=. ../.venv/bin/pytest tests/ -v

lint-node: install-node
	cd cloud-infra && npm run lint

format-node: install-node
	cd cloud-infra && npm run lint:fix

test-node: install-node
	cd cloud-infra && npm test

deploy-pipeline: install-node
	cd cloud-infra && npm run build
	cd cloud-infra && npx cdk deploy EntrixPipeline-$(ENVIRONMENT) -c environment=$(ENVIRONMENT)

deploy-infra: install-node
	cd cloud-infra && npm run build
	cd cloud-infra && npx cdk deploy EntrixInfrastructure-$(ENVIRONMENT) -c environment=$(ENVIRONMENT)

clean:
	rm -rf .venv
	rm -rf wattsup-app/__pycache__ wattsup-app/*/__pycache__
	rm -rf wattsup-app/.pytest_cache wattsup-app/.ruff_cache
	rm -rf cloud-infra/node_modules cloud-infra/cdk.out
	find cloud-infra -name "*.js" -o -name "*.d.ts" -delete 2>/dev/null || true