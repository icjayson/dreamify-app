"""Deployable Dreamify analysis runner.

This package intentionally does not import the legacy FastAPI/LangChain service or
its trusted Python REPL. It is designed to run inside an isolated Vercel Sandbox.
"""

from .constants import SCHEMA_VERSION

__all__ = ["SCHEMA_VERSION"]
