"""Tests for the FastAPI application."""

import asyncio

import httpx

from app.main import app


class ASGITestClient:
    """Small sync wrapper around httpx's async ASGI transport."""

    def get(self, path: str) -> httpx.Response:
        async def _get() -> httpx.Response:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                return await client.get(path)

        return asyncio.run(_get())


class TestFastAPIApp:
    """Test cases for FastAPI application."""

    def setup_method(self):
        """Set up test fixtures."""
        self.client = ASGITestClient()

    def test_root_endpoint(self):
        """Test root endpoint."""
        response = self.client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "version" in data
        assert "docs" in data

    def test_health_endpoint(self):
        """Test health check endpoint."""
        response = self.client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "dreamify-backend"

    def test_docs_endpoint(self):
        """Test API documentation endpoint."""
        response = self.client.get("/api/v1/docs")
        assert response.status_code == 200

    def test_openapi_endpoint(self):
        """Test OpenAPI schema endpoint."""
        response = self.client.get("/api/v1/openapi.json")
        assert response.status_code == 200
        data = response.json()
        assert "openapi" in data
        assert "info" in data
        assert "paths" in data

    def test_analytics_endpoints_exist(self):
        """Test that analytics endpoints are registered."""
        response = self.client.get("/api/v1/openapi.json")
        assert response.status_code == 200
        openapi_spec = response.json()

        # Check that analytics endpoints exist
        paths = openapi_spec.get("paths", {})
        assert "/api/v1/analytics/dashboard" in paths
        assert "/api/v1/analytics/data" in paths
        assert "/api/v1/analytics/insights" in paths

    def test_stripe_endpoints_exist(self):
        """Test that Stripe endpoints are registered."""
        response = self.client.get("/api/v1/openapi.json")
        assert response.status_code == 200
        openapi_spec = response.json()

        # Check that Stripe endpoints exist
        paths = openapi_spec.get("paths", {})
        assert "/api/v1/stripe/products" in paths
        assert "/api/v1/stripe/customers" in paths
        assert "/api/v1/stripe/checkout/sessions" in paths

    def test_dashboard_endpoints_exist(self):
        """Test that dashboard endpoints are registered."""
        response = self.client.get("/api/v1/openapi.json")
        assert response.status_code == 200
        openapi_spec = response.json()

        # Check that dashboard endpoints exist
        paths = openapi_spec.get("paths", {})
        assert "/api/v1/dashboard/generate" in paths
        assert "/api/v1/dashboard/list" in paths

    def test_user_asset_endpoints_exist(self):
        """Test that user asset endpoints are registered."""
        response = self.client.get("/api/v1/openapi.json")
        assert response.status_code == 200
        openapi_spec = response.json()

        # Check that files endpoints exist
        paths = openapi_spec.get("paths", {})
        assert "/api/v1/user/asset/upload" in paths
        assert "/api/v1/user/asset/list" in paths

    def test_conversation_dashboard_endpoint_exists(self):
        """Test that conversation dashboard endpoint is registered."""
        response = self.client.get("/api/v1/openapi.json")
        assert response.status_code == 200
        openapi_spec = response.json()

        paths = openapi_spec.get("paths", {})
        assert "/api/v1/conversation/{conversation_id}/dashboard" in paths
