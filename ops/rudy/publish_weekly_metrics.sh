#!/usr/bin/env bash
set -euo pipefail

set -a
source "${ATLAS_ENV_FILE:-/root/.hermes/secrets/atlas.env}"
source "${LINEAR_ENV_FILE:-/root/.hermes/secrets/linear.env}"
set +a

exec python3 "$(dirname "$0")/publish_weekly_metrics.py" "$@"
