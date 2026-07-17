#!/usr/bin/env bash
# Native (no-Docker) Ubuntu installer for the DebridStreamer self-host server.
# Builds the server + web app from the current checkout and installs them as a
# systemd service. Re-runnable: it rebuilds and restarts, preserving your env
# file and data. Requires Node.js 24+ (see deploy/ubuntu/README.md, Option B).
#
# Usage (from a repo checkout):  sudo bash deploy/ubuntu/install.sh
set -euo pipefail

PREFIX=/opt/debridstreamer
DATA_DIR=/var/lib/debridstreamer
ENV_DIR=/etc/debridstreamer
ENV_FILE="${ENV_DIR}/debridstreamer.env"
SERVICE_USER=debridstreamer

if [[ ${EUID} -ne 0 ]]; then
  echo "Please run with sudo (needs to install a systemd service)." >&2
  exit 1
fi

# Resolve the repo root from this script's location (deploy/ubuntu/install.sh).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

command -v node >/dev/null || { echo "Node.js not found. Install Node 24+ first." >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  echo "Node ${NODE_MAJOR} is too old - install Node 24+ (see README Option B)." >&2
  exit 1
fi

echo "==> Building web app"
( cd web && npm ci && npm run build )
echo "==> Building server"
( cd server && npm ci && npm run build )

echo "==> Installing runtime files to ${PREFIX}"
install -d "${PREFIX}/server" "${PREFIX}/web-dist"
rm -rf "${PREFIX}/server/dist"
cp -r server/dist "${PREFIX}/server/dist"
rm -rf "${PREFIX}/web-dist"
install -d "${PREFIX}/web-dist"
cp -r web/dist/. "${PREFIX}/web-dist/"

echo "==> Creating service user + data dir"
id -u "${SERVICE_USER}" >/dev/null 2>&1 || \
  useradd --system --home "${DATA_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${DATA_DIR}"

echo "==> Installing env file (kept if it already exists)"
install -d "${ENV_DIR}"
if [[ ! -f "${ENV_FILE}" ]]; then
  cp deploy/compose/.env.example "${ENV_FILE}"
  # Seed a strong secret key so a first boot isn't insecure-by-default.
  SECRET="$(openssl rand -base64 32 2>/dev/null || true)"
  if [[ -n "${SECRET}" ]]; then
    sed -i "s#^DS_SERVER_SECRET_KEY=.*#DS_SERVER_SECRET_KEY=${SECRET}#" "${ENV_FILE}"
  fi
  chmod 600 "${ENV_FILE}"
  echo "    Wrote ${ENV_FILE} - review it (set DS_SERVER_SETUP_TOKEN, proxy flags)."
else
  echo "    ${ENV_FILE} already exists - left unchanged."
fi

echo "==> Installing systemd service"
cp deploy/systemd/debridstreamer.service /etc/systemd/system/debridstreamer.service
systemctl daemon-reload
systemctl enable --now debridstreamer

echo
echo "Done. Server: http://$(hostname -I | awk '{print $1}'):43110"
systemctl --no-pager --lines=0 status debridstreamer || true
