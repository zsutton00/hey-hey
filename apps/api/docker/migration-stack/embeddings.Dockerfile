# syntax=docker/dockerfile:1

# Reusable dependency base: generated contracts and application source must not
# invalidate the large third-party Python/ML installation.
FROM python:3.11-slim AS dependencies

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=5005

ARG PIP_VERSION=24.3.1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=embeddings /requirements.txt /constraints.txt ./

# Keep the selected repository's dependency contract. Install its local editable
# packages later, when their generated source is available.
RUN python - <<'PY'
from pathlib import Path

requirements = Path("requirements.txt").read_text().splitlines(keepends=True)
external = []
generated = []
for line in requirements:
    if line.strip().startswith("-e generated/"):
        generated.append(line)
    else:
        external.append(line)
Path("requirements-external.txt").write_text("".join(external))
Path("requirements-generated.txt").write_text("".join(generated))
PY

RUN --mount=type=cache,id=heyhey-migration-pip,target=/root/.cache/pip,sharing=locked \
    python -m pip install "pip==${PIP_VERSION}" && \
    python -m pip install --constraint constraints.txt --requirement requirements-external.txt

FROM dependencies AS runtime

COPY --from=embeddings /generated/ generated/

# Resolve generated-package dependencies normally against the same constraints;
# changed generated metadata can add requirements without hiding them via --no-deps.
RUN --mount=type=cache,id=heyhey-migration-pip,target=/root/.cache/pip,sharing=locked \
    python -m pip install --constraint constraints.txt --requirement requirements-generated.txt

RUN python -c "import hey_hey_embeddings_models; import hey_hey_events_models; import einops"

COPY --from=embeddings / ./

# Dev volumes share the host filesystem; do not reserve a percentage of that
# filesystem for an otherwise empty index. Keep the memory limit unchanged.
RUN python - <<'VESPA_DEV'
from pathlib import Path
import xml.etree.ElementTree as ET

path = Path("vespa-app/services.xml")
tree = ET.parse(path)
content = tree.getroot().find("content[@id='embeddings']")
if content is None:
    raise ValueError("Vespa application is missing the embeddings content cluster")
for tags in (("tuning", "resource-limits", "disk"),
             ("engine", "proton", "resource-limits", "disk")):
    parent = content
    for tag in tags:
        child = parent.find(tag)
        if child is None:
            child = ET.SubElement(parent, tag)
        parent = child
    parent.text = "1.0"
tree.write(path, encoding="unicode", xml_declaration=True)
VESPA_DEV

RUN useradd --create-home --shell /bin/bash app && chown -R app:app /app
USER app

# Match the selected embeddings image: INT8 initialization requires a verified
# artifact baked into the image, without a runtime download or host mount.
RUN python scripts/build_jina_int8.py \
      --output /app/models/jina-colbert-v2-int8 \
      --cache /tmp/jina-build-cache && \
    rm -rf /tmp/jina-build-cache

EXPOSE 5005
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost:5005/health || exit 1

CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT} --workers ${GUNICORN_WORKERS:-2} --timeout ${GUNICORN_TIMEOUT:-120} -k uvicorn.workers.UvicornWorker embedding_service.main:app"]
