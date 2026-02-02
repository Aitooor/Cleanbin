#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="aitooor/cleanbin"
VERSION_FILE=".docker-version"
LATEST_TAG="latest"

if [ "$#" -gt 1 ]; then
  echo "Uso:" >&2
  echo "  $0              # calcula automáticamente la siguiente versión (PATCH +1)" >&2
  echo "  $0 <version>    # fuerza una versión concreta (opcional)" >&2
  exit 1
fi

NEW_VERSION=""

if [ "$#" -eq 1 ]; then
  # Versión fijada manualmente por parámetro
  NEW_VERSION="$1"
else
  # Auto-versionado: leemos la última versión del fichero o empezamos en 0.0.1
  if [ -f "$VERSION_FILE" ]; then
    PREV_VERSION="$(cat "$VERSION_FILE")"
  else
    PREV_VERSION=""
  fi

  if [ -z "${PREV_VERSION:-}" ]; then
    NEW_VERSION="0.0.1"
  else
    IFS='.' read -r MAJOR MINOR PATCH <<EOF
$PREV_VERSION
EOF
    if [ -z "$MAJOR" ] || [ -z "$MINOR" ] || [ -z "$PATCH" ]; then
      echo "Formato de versión inválido en $VERSION_FILE (esperado MAJOR.MINOR.PATCH)." >&2
      exit 1
    fi
    PATCH=$((PATCH + 1))
    NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
  fi
fi

echo "Versión a publicar: ${NEW_VERSION}"
echo "${NEW_VERSION}" > "${VERSION_FILE}"

echo "Limpiando builders inactivos..."
docker buildx rm --all-inactive --force 2>/dev/null || true

echo "Creando builder y haciendo bootstrap..."
docker buildx create --use >/dev/null 2>&1 || true
docker buildx inspect --bootstrap >/dev/null 2>&1 || true

echo "Construyendo y publicando multi-plataforma:"
echo "  ${REPOSITORY}:${LATEST_TAG}"
echo "  ${REPOSITORY}:${NEW_VERSION}"

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t "${REPOSITORY}:${LATEST_TAG}" \
  -t "${REPOSITORY}:${NEW_VERSION}" \
  --push .

echo "Limpiando builders inactivos de nuevo..."
docker buildx rm --all-inactive --force 2>/dev/null || true

echo "Listo. Publicadas tags:"
echo "  ${REPOSITORY}:${NEW_VERSION}"
echo "  ${REPOSITORY}:${LATEST_TAG}"
