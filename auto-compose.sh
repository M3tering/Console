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
      echo 'CONSOLE_ROLE in .env selects standalone (default), central, or gateway (Console + agent).'
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
if [[ -n "$project" && ! "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then echo 'Invalid Compose project name.' >&2; exit 2; fi
[[ -f .env ]] || { echo 'Missing .env: configure the existing services before deployment.' >&2; exit 1; }
# Read one .env setting without executing the file; strips surrounding quotes.
env_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env | tail -1 \
    | sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
role=$(env_value CONSOLE_ROLE | sed -n 's/^\([a-z]*\).*/\1/p')
role="${role:-standalone}"
services=(console)
# Gateway secrets must belong to the user the containers run as (root in the published image).
as_root=(); [[ "$(id -u)" -eq 0 ]] || as_root=(sudo)
secret_uid="${AGENT_SECRET_UID:-0}"
[[ "$secret_uid" =~ ^[0-9]+$ ]] || { echo 'AGENT_SECRET_UID must be a numeric user ID.' >&2; exit 2; }
has_credential() { "${as_root[@]}" test -s .data/agent/credential; }
case "$role" in
  standalone)
    compose_file=compose.yaml; default_image=ghcr.io/m3tering/console:main ;;
  central)
    compose_file=compose.central.yaml; default_image=ghcr.io/fluxion9/console:main
    [[ -n "$(env_value CENTRAL_DOMAIN)" ]] || { echo 'Set CENTRAL_DOMAIN in .env to the DNS name pointing at this server.' >&2; exit 2; }
    # The administrator is created only on first start; later starts ignore the password.
    if [[ ! -s .data/central.db ]]; then
      password=$(env_value CENTRAL_ADMIN_PASSWORD)
      (( ${#password} >= 16 )) || { echo 'Set CENTRAL_ADMIN_PASSWORD in .env (at least 16 characters) for the first central start.' >&2; exit 2; }
    fi ;;
  gateway)
    compose_file=compose.gateway.yaml; default_image=ghcr.io/fluxion9/console:main; services=(console agent)
    central_url=$(env_value CENTRAL_URL)
    insecure=$(env_value CENTRAL_ALLOW_INSECURE_DEVELOPMENT)
    [[ "$central_url" =~ ^wss://[^/?#@[:space:]]+/?$ || ( "$insecure" == true && "$central_url" =~ ^ws://[^/?#@[:space:]]+/?$ ) ]] \
      || { echo 'Set CENTRAL_URL in .env to your central origin, for example wss://console.example.com (no path).' >&2; exit 2; }
    for name in APPLICATION_ID API_TOKEN; do
      [[ -n "$(env_value "$name")" ]] || { echo "Set $name in .env: the agent reads this gateway's ChirpStack uplinks with it." >&2; exit 2; }
    done
    if ! has_credential && [[ -z "$(env_value AGENT_ENROLLMENT_TOKEN)" ]]; then
      echo 'This gateway is not enrolled yet. On central open Gateways, add this gateway, and paste its' >&2
      echo 'AGENT_ENROLLMENT_TOKEN=... line into .env. The token expires after ten minutes.' >&2; exit 2
    fi ;;
  *) echo 'CONSOLE_ROLE in .env must be standalone, central or gateway.' >&2; exit 2 ;;
esac
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
compose=(docker compose --project-name "$project" -f "$compose_file")
old_container=$("${compose[@]}" ps -aq console | head -1)
old_id='' old_role=''
if [[ -n "$old_container" ]]; then
  old_id=$(docker inspect --format '{{.Image}}' "$old_container")
  old_ref=$(docker inspect --format '{{.Config.Image}}' "$old_container")
  old_role=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$old_container" | sed -n 's/^CONSOLE_ROLE=//p' | tail -1)
  echo "Current Console: $old_ref ($old_id)"
  # Reuse the running image only for the same role: a standalone image may lack central support.
  if [[ -z "$image" && "$old_ref" == ghcr.io/* && "${old_role:-standalone}" == "$role" ]]; then image="$old_ref"; fi
fi
export CONSOLE_IMAGE="${image:-$default_image}"
[[ "$CONSOLE_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+(:[a-zA-Z0-9._-]+|@sha256:[a-f0-9]{64})$ ]] || { echo 'Specify a published GHCR image with an explicit tag or digest.' >&2; exit 2; }
echo "Project: $project; role: $role; update image: $CONSOLE_IMAGE"
"${compose[@]}" config --quiet

if [[ "$role" == gateway ]]; then
  # Owner-only local secrets shared by Console and agent. Existing secrets are never replaced.
  "${as_root[@]}" sh -c '
    set -e; uid=$1; umask 077
    mkdir -p .data/agent .data/updater
    chmod 700 .data/agent .data/updater; chown "$uid" .data/agent .data/updater
    for name in fallback-secret updater-secret; do
      file=.data/agent/$name
      [ -e "$file" ] || head -c 32 /dev/urandom | base64 | tr "+/" "-_" | tr -d "=\n" > "$file"
      chmod 600 "$file"; chown "$uid" "$file"
    done
    if [ -e .data/agent/credential ]; then chmod 600 .data/agent/credential; chown "$uid" .data/agent/credential; fi
  ' sh "$secret_uid"
fi

# The agent counts as ready once it has stayed up without restarting and holds a credential.
agent_ready() {
  local container status restarts check
  container=$("${compose[@]}" ps -q agent | head -1); [[ -n "$container" ]] || return 1
  for (( check=1; check<=${AGENT_READY_CHECKS:-45}; check++ )); do
    read -r status restarts < <(docker inspect --format '{{.State.Status}} {{.RestartCount}}' "$container")
    [[ "$status" == running && "$restarts" == 0 ]] || return 1
    if (( check >= ${AGENT_STABLE_CHECKS:-5} )) && has_credential; then return 0; fi
    sleep "${AGENT_READY_INTERVAL:-2}"
  done
  return 1
}
deploy_failed() {
  echo "${services[*]} failed readiness. Recent logs:" >&2
  "${compose[@]}" logs --tail 80 "${services[@]}" >&2 || true
  if [[ -z "$old_id" ]]; then exit 1; fi
  if [[ "$role" != gateway || "${old_role:-standalone}" == gateway ]]; then
    echo 'Restoring the previous image; persistent data has not been removed.' >&2
    CONSOLE_IMAGE="$old_id" "${compose[@]}" up --detach --no-deps --no-build --pull never --force-recreate "${services[@]}" || true
  elif ! "${as_root[@]}" test -e .data/agent/operations.db; then
    # The agent never got past enrollment, so it handled no meter reports: standalone can safely resume.
    echo 'Restoring the standalone Console; the agent never started handling reports.' >&2
    "${compose[@]}" stop agent || true; "${compose[@]}" rm --force agent || true
    CONSOLE_IMAGE="$old_id" docker compose --project-name "$project" -f compose.yaml up --detach --no-deps --no-build --pull never --force-recreate console || true
  else
    # Never run a standalone subscriber beside an agent journal: two deciders could answer one meter.
    echo 'The agent has an operations journal, so standalone was NOT restarted automatically.' >&2
    echo 'Fix the problem above and rerun this script. See docs/centralized/deployment.md to return to standalone.' >&2
  fi
  exit 1
}

# Keep the old service and image until the correct architecture is downloaded.
"${compose[@]}" pull "${services[@]}"
# Stopping Console first also stops a standalone MQTT subscriber before the agent takes over.
"${compose[@]}" stop "${services[@]}"
"${compose[@]}" rm --force "${services[@]}"
"${compose[@]}" up --detach --no-deps --no-build --pull never --wait --wait-timeout 240 "${services[@]}" || deploy_failed
if [[ "$role" == gateway ]]; then agent_ready || deploy_failed; fi
new_id=$(docker inspect --format '{{.Image}}' "$("${compose[@]}" ps -q console)")
if [[ -n "$old_id" && "$old_id" != "$new_id" && -z "$(docker ps -aq --filter "ancestor=$old_id")" ]]; then
  # No force: Docker keeps images that still have other tags/references.
  docker image rm "$old_id" || echo 'Previous image retained because it is still referenced.'
fi
if [[ "$role" == central ]]; then
  # TLS proxy (Caddy) publishes the loopback-only Console on ports 80/443.
  "${compose[@]}" up --detach tls-proxy || { echo 'Console is running, but the TLS proxy failed to start; check ports 80/443.' >&2; exit 1; }
fi
"${compose[@]}" ps
echo 'Console updated. Database, extension volumes and .env were preserved.'
if [[ "$role" == gateway ]]; then
  echo 'Gateway agent is running. Its card on central should show Online within a minute.'
  if [[ -n "$(env_value AGENT_ENROLLMENT_TOKEN)" ]]; then
    echo 'Enrollment is complete: remove the AGENT_ENROLLMENT_TOKEN line from .env (it cannot be reused).'
  fi
fi
if [[ "$role" == central ]]; then
  admin=$(env_value CENTRAL_ADMIN_USERNAME)
  echo "Central: https://$(env_value CENTRAL_DOMAIN) (sign in as ${admin:-admin})"
fi
