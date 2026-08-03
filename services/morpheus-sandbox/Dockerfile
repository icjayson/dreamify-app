FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONHASHSEED=0 \
    PYTHONPATH=/opt/dreamify

WORKDIR /opt/dreamify

COPY requirements-runner.txt ./requirements-runner.txt
RUN pip install --no-cache-dir --requirement requirements-runner.txt

# Deliberately copy only the isolated command runner. The legacy FastAPI server,
# LangChain graph, and PythonREPLTool are retained in Git for migration reference
# but cannot be imported from this deployable image.
COPY runner ./runner

RUN useradd --create-home --uid 10001 runner \
    && mkdir -p /vercel/sandbox \
    && chown -R runner:runner /vercel/sandbox /opt/dreamify

USER runner
WORKDIR /vercel/sandbox

ENTRYPOINT ["python", "-m", "runner.main"]
CMD ["--help"]
