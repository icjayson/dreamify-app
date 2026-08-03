PYTHON ?= python3
API_VENV ?= .venv
SANDBOX_VENV ?= services/morpheus-sandbox/.venv
API_PYTHON := $(API_VENV)/bin/python
SANDBOX_PYTHON := $(SANDBOX_VENV)/bin/python
LOCAL_DATABASE_URL ?= postgresql://dreamify:dreamify_local_only@127.0.0.1:5432/dreamify
LOCAL_STORAGE_PATH ?= /tmp/dreamify-storage

.PHONY: install dev test test-api test-sandbox verify migrate seed

install:
	npm ci
	$(PYTHON) -m venv $(API_VENV)
	$(API_PYTHON) -m pip install --upgrade pip
	$(API_PYTHON) -m pip install -r services/api/requirements-dev.txt
	$(PYTHON) -m venv $(SANDBOX_VENV)
	$(SANDBOX_PYTHON) -m pip install --upgrade pip
	$(SANDBOX_PYTHON) -m pip install -r services/morpheus-sandbox/requirements-dev.txt

dev:
	npm run dev

test:
	npm run test
	$(MAKE) test-api
	$(MAKE) test-sandbox

test-api:
	cd services/api && ../../$(API_PYTHON) -m pytest -q tests_platform

test-sandbox:
	cd services/morpheus-sandbox && .venv/bin/python -m pytest -q tests

migrate:
	cd services/api && APP_ENV=development DATABASE_URL="$(LOCAL_DATABASE_URL)" DIRECT_DATABASE_URL="$(LOCAL_DATABASE_URL)" STORAGE_BACKEND=local LOCAL_STORAGE_PATH="$(LOCAL_STORAGE_PATH)" ../../$(API_PYTHON) -m alembic upgrade head

seed:
	cd services/api && APP_ENV=development DATABASE_URL="$(LOCAL_DATABASE_URL)" DIRECT_DATABASE_URL="$(LOCAL_DATABASE_URL)" STORAGE_BACKEND=local LOCAL_STORAGE_PATH="$(LOCAL_STORAGE_PATH)" ../../$(API_PYTHON) scripts/seed_database.py

verify:
	npm run verify
	$(MAKE) test-api
	$(MAKE) test-sandbox
	git diff --check
