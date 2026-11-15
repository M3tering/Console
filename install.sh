#!/usr/bin/env bash
# Build first; replace only this Compose project's console service. Keep all data.
set -euo pipefail
project_args=()
case "${1:-}" in
  --help|-h)
    printf '%s\n' 'Usage: ./install.sh [--project-name NAME]' 'Builds this checkout, recreates the console container, and waits for readiness.' 'Use the existing Compose project name to update a deployment with a custom name.'
    exit 0 ;;
  --project-name)
    if [[ $# != 2 || ! $2 =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
      printf '%s\n' 'Provide a valid Compose project name.' >&2; exit 2
    fi
    project_args=(--project-name "$2") ;;
  '') ;;
  *) printf '%s\n' 'Unknown option. Run ./install.sh --help.' >&2; exit 2 ;;
esac
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ ! -f .env ]]; then
  printf '%s\n' 'Missing .env. Copy .env.example to .env and configure your credentials and services first.' >&2
  exit 1
fi
command -v docker >/dev/null || { printf '%s\n' 'Docker with the Compose plugin is required.' >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null
compose=(docker compose "${project_args[@]}" -f compose.yaml -f compose.local.yaml)
"${compose[@]}" config --quiet
printf '%s\n' 'Building the current checkout. The running console stays available during the build.'
"${compose[@]}" build console
printf '%s\n' 'Replacing the console container and waiting for the new build to become ready…'
if ! "${compose[@]}" up --detach --no-deps --no-build --pull never --force-recreate --wait --wait-timeout 240 console; then
  printf '%s\n' 'The replacement did not become ready. Data volumes were preserved.' 'Inspect the console logs with docker compose -f compose.yaml -f compose.local.yaml logs console (include your project name if set).' >&2
  exit 1
fi
printf '%s\n' 'The current build is running. Your .env, database, and extension volumes are preserved.'
"${compose[@]}" ps console
