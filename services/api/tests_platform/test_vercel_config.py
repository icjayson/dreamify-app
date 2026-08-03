import json
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]


def test_vercel_routes_every_public_path_to_the_fastapi_function() -> None:
    config = json.loads((SERVICE_ROOT / "vercel.json").read_text())

    assert config["rewrites"] == [{"source": "/(.*)", "destination": "/api/index"}]
    assert "api/index.py" in config["functions"]
