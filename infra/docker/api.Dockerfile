# API + agents image: multi-stage, non-root.
FROM python:3.12-slim AS build
WORKDIR /build
RUN pip install --no-cache-dir --prefix=/install \
    "fastapi>=0.110" "uvicorn[standard]>=0.27" "pydantic>=2.6" "pydantic-settings>=2.2" "httpx>=0.27" "pyyaml>=6" "redis>=5" \
    "pillow>=10" "python-multipart>=0.0.9" "websockets>=12" "rasterio>=1.3" "numpy>=1.26" "cryptography>=42" "tzdata>=2024.1"

FROM python:3.12-slim
RUN useradd --system --uid 10001 --create-home vayu
WORKDIR /app
COPY --from=build /install /usr/local
COPY services ./services
COPY packages ./packages
COPY config ./config
COPY tests/integration/fixtures ./tests/integration/fixtures
COPY run_api.py ./
RUN mkdir -p /app/var && chown -R vayu:vayu /app/var
USER 10001
ENV PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8010
EXPOSE 8010
HEALTHCHECK --interval=15s --timeout=3s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8010/healthz').status==200 else 1)"
CMD ["python", "run_api.py"]
