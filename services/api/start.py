#!/usr/bin/env python3
"""Local development entry point. Configuration comes only from the environment."""

import os

import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
        reload=os.environ.get("RELOAD", "false").lower() == "true",
    )
