.PHONY: build-local runner-help test

build-local:
	docker build --tag dreamify-morpheus-sandbox:local .

runner-help:
	python3 -m runner.main --help

test:
	python3 -m pytest -q tests
