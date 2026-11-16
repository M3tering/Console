#!/usr/bin/env bash
# Update only this Compose project's Console from its published multi-arch image.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
project="${COMPOSE_PROJECT_NAME:-}"
image="${CONSOLE_IMAGE:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-name|--image)
      [[ $# -ge 2 && -n "$2" ]] || { echo "Missing value for $1" >&2; exit 2; }
      if [[ "$1" == --project-name ]]; then project="$2"; else image="$2"; fi
      shift 2 ;;
    --help|-h)
      echo 'Usage: ./auto-compose.sh [--project-name NAME] [--image ghcr.io/OWNER/console:TAG]'
      echo 'Pulls the published image for this device, updates only Console, and preserves .env and all volumes.'
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
if [[ -n "$project" && ! "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then echo 'Invalid Compose project name.' >&2; exit 2; fi
[[ -f .env ]] || { echo 'Missing .env: configure the existing services before deployment.' >&2; exit 1; }
command -v docker >/dev/null || { echo 'Docker must already be installed.' >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null
# Discover deployments belonging to this checkout, not unrelated Compose projects.
if [[ -z "$project" ]]; then
  projects=()
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    directory=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$container")
    if [[ "$directory" == "$PWD" ]]; then
      candidate=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")
      [[ " ${projects[*]:-} " == *" $candidate "* ]] || projects+=("$candidate")
    fi
  done < <(docker ps -aq --filter label=com.docker.compose.service=console)
  if (( ${#projects[@]} > 1 )); then echo 'Multiple Console projects found here. Specify --project-name.' >&2; exit 1; fi
  project="${projects[0]:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')}"
fi
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Invalid Compose project name.' >&2; exit 2; }
compose=(docker compose --project-name "$project" -f compose.yaml)
old_container=$("${compose[@]}" ps -aq console | head -1)
old_id=''
if [[ -n "$old_container" ]]; then
  old_id=$(docker inspect --format '{{.Image}}' "$old_container")
  old_ref=$(docker inspect --format '{{.Config.Image}}' "$old_container")
  echo "Current Console: $old_ref ($old_id)"
  if [[ -z "$image" && "$old_ref" == ghcr.io/* ]]; then image="$old_ref"; fi
fi
export CONSOLE_IMAGE="${image:-ghcr.io/m3tering/console:main}"
[[ "$CONSOLE_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+(:[a-zA-Z0-9._-]+|@sha256:[a-f0-9]{64})$ ]] || { echo 'Specify a published GHCR image with an explicit tag or digest.' >&2; exit 2; }
echo "Project: $project; update image: $CONSOLE_IMAGE"
"${compose[@]}" config --quiet
# Keep the old service and image until the correct architecture is downloaded.
"${compose[@]}" pull console
"${compose[@]}" stop console
"${compose[@]}" rm --force console
if ! "${compose[@]}" up --detach --no-deps --no-build --pull never --wait --wait-timeout 240 console; then
  echo 'Console failed readiness. Recent logs:' >&2
  "${compose[@]}" logs --tail 80 console >&2 || true
  if [[ -n "$old_id" ]]; then
    echo 'Restoring the previous image; persistent data has not been removed.' >&2
    CONSOLE_IMAGE="$old_id" "${compose[@]}" up --detach --no-deps --no-build --pull never --force-recreate console || true
  fi
  exit 1
fi
new_id=$(docker inspect --format '{{.Image}}' "$("${compose[@]}" ps -q console)")
if [[ -n "$old_id" && "$old_id" != "$new_id" && -z "$(docker ps -aq --filter "ancestor=$old_id")" ]]; then
  # No force: Docker keeps images that still have other tags/references.
  docker image rm "$old_id" || echo 'Previous image retained because it is still referenced.'
fi
"${compose[@]}" ps console
echo 'Console updated. Database, extension volumes and .env were preserved.'
