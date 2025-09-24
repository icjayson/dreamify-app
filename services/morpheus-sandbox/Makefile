# Build the Docker image
build-local:
	docker compose build

# Run the container and inject config.yaml
run-local:
	docker compose up -d
	docker cp ./config/config.yaml ocr-merchant-self-onboard-backend:/app/config/config.yaml
	docker cp ./model/. ocr-merchant-self-onboard-backend:/app/model/
	docker compose logs -f

# Stop the container
down:
	docker compose down

run-streamlit:
	streamlit run streamlit/streamlit_app.py --server.port 8501 --server.address 0.0.0.0
