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
if [[ ! -f .env ]]; then
  [[ -f .env.example ]] || { echo 'Missing .env: configure the existing services before deployment.' >&2; exit 1; }
  # First run: start from the template, readable only by its owner because it holds keys.
  (umask 077; cp .env.example .env)
  echo 'Created .env from .env.example (permissions 600). Fill in at least:'
  echo '  API_TOKEN, APPLICATION_ID   ChirpStack API token and application UUID'
  echo '  ETHEREUM_PRIVATE_KEY        wallet key for this Console (use a test wallet first)'
  echo 'For central or gateway mode also set CONSOLE_ROLE; see docs/deployment-guide.md.'
  echo 'Then run ./auto-compose.sh again.'
  exit 0
fi
# Read one .env setting without executing the file; strips surrounding quotes.
env_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env | tail -1 \
    | sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
# Images come from the repository this checkout follows, never from .env.
if [[ -n "$(env_value CONSOLE_IMAGE)" ]]; then
  echo 'Note: CONSOLE_IMAGE in .env is ignored; images follow this checkout'"'"'s GitHub repository. Remove that line, and use --image to pin a build.'
fi
# CI publishes images as ghcr.io/<owner>/<repo>, named after the GitHub repository,
# so follow the repository this checkout was cloned from.
repo_image='' source_repo=''
if remote=$(git remote get-url origin 2>/dev/null); then
  case "$remote" in
    git@github.com:*) slug=${remote#git@github.com:} ;;
    ssh://git@github.com/*) slug=${remote#ssh://git@github.com/} ;;
    https://github.com/*|https://*@github.com/*) slug=${remote#*github.com/} ;;
    *) slug='' ;;
  esac
  slug=${slug%/}; slug=${slug%.git}
  if [[ "$slug" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
    source_repo=$slug; repo_image="ghcr.io/$(tr '[:upper:]' '[:lower:]' <<<"$slug")"
  fi
fi
# The optional updater image and its signature trust follow the same repository.
if [[ -n "$repo_image" ]]; then
  export UPDATER_IMAGE="$repo_image-updater:main"
  export UPDATER_IMAGE_REPOSITORY="$repo_image" UPDATER_SOURCE_REPOSITORY="$source_repo"
fi
role=$(env_value CONSOLE_ROLE | sed -n 's/^\([a-z]*\).*/\1/p')
role="${role:-standalone}"
services=(console)
# Gateway secrets must belong to the user the containers run as (root in the published image).
as_root=(); [[ "$(id -u)" -eq 0 ]] || as_root=(sudo)
secret_uid="${AGENT_SECRET_UID:-0}"
[[ "$secret_uid" =~ ^[0-9]+$ ]] || { echo 'AGENT_SECRET_UID must be a numeric user ID.' >&2; exit 2; }
has_credential() { "${as_root[@]}" test -s .data/agent/credential; }
# Template values such as API_TOKEN=... crash the Console later with an unclear error; stop now instead.
placeholders=$(sed -n -E "s/^[[:space:]]*([A-Za-z0-9_]+)[[:space:]]*=[[:space:]]*[\"']?(\.\.\.|REPLACE_WITH_[A-Za-z0-9_]*)[\"']?[[:space:]]*(#.*)?$/\1/p" .env | paste -sd, - | sed 's/,/, /g')
# Central never talks to ChirpStack, so its template ChirpStack lines may stay as they are.
if [[ "$role" == central ]]; then placeholders=$(tr -d ' ' <<<"$placeholders" | tr ',' '\n' | grep -vxE 'API_TOKEN|APPLICATION_ID' | paste -sd, - | sed 's/,/, /g' || true); fi
[[ -z "$placeholders" ]] || { echo "Replace the placeholder values in .env: $placeholders" >&2; exit 2; }
require_chirpstack() {
  [[ -n "$(env_value API_TOKEN)" ]] || { echo 'Set API_TOKEN in .env to a ChirpStack API token.' >&2; exit 2; }
  [[ "$(env_value APPLICATION_ID)" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
    || { echo 'Set APPLICATION_ID in .env to your ChirpStack application UUID (Applications page in ChirpStack).' >&2; exit 2; }
}
case "$role" in
  standalone)
    require_chirpstack
    compose_file=compose.yaml; default_image=${repo_image:-ghcr.io/m3tering/console}:main ;;
  central)
    compose_file=compose.central.yaml; default_image=${repo_image:-ghcr.io/fluxion9/console}:main
    [[ -n "$(env_value CENTRAL_DOMAIN)" ]] || { echo 'Set CENTRAL_DOMAIN in .env to the DNS name pointing at this server.' >&2; exit 2; }
    # The administrator is created only on first start; later starts ignore the password.
    if [[ ! -s .data/central.db ]]; then
      password=$(env_value CENTRAL_ADMIN_PASSWORD)
      (( ${#password} >= 7 )) || { echo 'Set CENTRAL_ADMIN_PASSWORD in .env (at least 7 characters) for the first central start.' >&2; exit 2; }
    fi ;;
  gateway)
    compose_file=compose.gateway.yaml; default_image=${repo_image:-ghcr.io/fluxion9/console}:main; services=(console agent)
    central_url=$(env_value CENTRAL_URL)
    insecure=$(env_value CENTRAL_ALLOW_INSECURE_DEVELOPMENT)
    [[ "$central_url" =~ ^wss://[^/?#@[:space:]]+/?$ || ( "$insecure" == true && "$central_url" =~ ^ws://[^/?#@[:space:]]+/?$ ) ]] \
      || { echo 'Set CENTRAL_URL in .env to your central origin, for example wss://console.example.com (no path).' >&2; exit 2; }
    require_chirpstack
    if ! has_credential && [[ -z "$(env_value AGENT_ENROLLMENT_TOKEN)" ]]; then
      echo 'This gateway is not enrolled yet. On central open Gateways, add this gateway, and paste its' >&2
      echo 'AGENT_ENROLLMENT_TOKEN=... line into .env. The token expires after ten minutes.' >&2; exit 2
    fi ;;
  *) echo 'CONSOLE_ROLE in .env must be standalone, central or gateway.' >&2; exit 2 ;;
esac
command -v docker >/dev/null || { echo 'Docker is not installed. Install it with: curl -fsSL https://get.docker.com | sudo sh' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo 'The Docker Compose plugin is missing; install docker-compose-plugin.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Cannot reach Docker. Run with sudo, or: sudo usermod -aG docker "$USER" and log in again.' >&2; exit 1; }
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
# Gateways: run the signed updater when the owner enabled it, or keep an existing one current.
manage_updater=false
if [[ "$role" == gateway ]] && { [[ "$(env_value REMOTE_UPDATES_ENABLED)" == true ]] ||
    [[ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=updater)" ]]; }; then
  [[ -n "$repo_image" ]] || { echo 'Remote updates need a GitHub origin remote: the updater only trusts images signed by that repository.' >&2; exit 2; }
  manage_updater=true
  export COMPOSE_PROJECT_NAME="$project" UPDATER_DEPLOY_DIRECTORY="$PWD"
  compose+=(-f compose.updater.yaml)
fi
old_container=$("${compose[@]}" ps -aq console | head -1)
old_id='' old_role=''
if [[ -n "$old_container" ]]; then
  old_id=$(docker inspect --format '{{.Image}}' "$old_container")
  old_ref=$(docker inspect --format '{{.Config.Image}}' "$old_container")
  # The compose file that created the container says which role it ran. Its environment does not:
  # .env values such as CONSOLE_ROLE leak into a standalone container through env_file.
  case "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$old_container")" in
    *compose.gateway.yaml*) old_role=gateway ;;
    *compose.central.yaml*) old_role=central ;;
    *) old_role=standalone ;;
  esac
  echo "Current Console: $old_ref ($old_id)"
  # Keep the running tag or digest only for the same role (a standalone image may lack central
  # support) and the same repository as this checkout (the remote may have been switched).
  # The Browser app and its -browser image were removed: a -browser container moves to the normal image.
  old_repo=${old_ref%@*}; old_repo=${old_repo%:*}
  if [[ -z "$image" && "$old_ref" == ghcr.io/* && "$old_role" == "$role" && "$old_repo" != *-browser &&
        ( -z "$repo_image" || "$old_repo" == "$repo_image" ) ]]; then
    image="$old_ref"
  fi
fi
export CONSOLE_IMAGE="${image:-$default_image}"
[[ "$CONSOLE_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+(:[a-zA-Z0-9._-]+|@sha256:[a-f0-9]{64})$ ]] || { echo 'Specify a published GHCR image with an explicit tag or digest.' >&2; exit 2; }
echo "Project: $project; role: $role; update image: $CONSOLE_IMAGE"
[[ -z "$repo_image" ]] || echo "Image repository from git origin: $repo_image"
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
# Each failure says why, so a failed deploy can be diagnosed from the script output alone.
agent_ready() {
  local container status restarts check
  container=$("${compose[@]}" ps -q agent | head -1)
  [[ -n "$container" ]] || { echo 'Agent check: no agent container was created.' >&2; return 1; }
  for (( check=1; check<=${AGENT_READY_CHECKS:-45}; check++ )); do
    read -r status restarts < <(docker inspect --format '{{.State.Status}} {{.RestartCount}}' "$container")
    if [[ "$status" != running || "$restarts" != 0 ]]; then
      echo "Agent check: the agent stopped or restarted (status $status, restarts $restarts)." >&2; return 1
    fi
    if (( check >= ${AGENT_STABLE_CHECKS:-5} )) && has_credential; then return 0; fi
    sleep "${AGENT_READY_INTERVAL:-2}"
  done
  echo 'Agent check: the agent is running but never stored a credential; enrollment did not finish (check the token and that central is reachable).' >&2
  return 1
}
# The gateway Console's loopback fallback port must be free once our own Console has stopped.
fallback_port=$(env_value GATEWAY_FALLBACK_PORT); fallback_port=${fallback_port:-3011}
port_busy() { command -v ss >/dev/null && [[ -n "$(ss -ltnH "sport = :$1" 2>/dev/null)" ]]; }
port_owner() { "${as_root[@]}" ss -ltnpH "sport = :$1" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -1; }
# Only images that contain the agent can run the gateway pair.
image_has_agent() { docker run --rm --entrypoint test "$1" -f /opt/app/dist/agent/index.js >/dev/null 2>&1; }
deploy_failed() {
  echo "${services[*]} failed readiness. Recent logs:" >&2
  "${compose[@]}" logs --tail 80 "${services[@]}" >&2 || true
  if [[ -z "$old_id" ]]; then exit 1; fi
  if [[ "$role" == gateway && "$old_role" == gateway ]] && ! image_has_agent "$old_id"; then
    # Rolling back onto an image without the agent would leave the gateway with no working agent at all.
    echo 'The previous image has no agent, so it was NOT restored; the new pair keeps running and retrying.' >&2
    echo 'Fix the problem shown above and rerun this script.' >&2
  elif [[ "$role" != gateway || "$old_role" == gateway ]]; then
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
# The updater must not replace Console and agent while this script does.
if $manage_updater; then "${compose[@]}" stop updater; fi
# Stopping Console first also stops a standalone MQTT subscriber before the agent takes over.
"${compose[@]}" stop "${services[@]}"
if [[ "$role" == gateway ]] && port_busy "$fallback_port"; then
  owner=$(port_owner "$fallback_port")
  echo "Port $fallback_port is already used by ${owner:-another program}. The gateway Console needs it for its local fallback." >&2
  echo "Set GATEWAY_FALLBACK_PORT in .env to a free port (for example 3011 or 3101) and rerun. Nothing was changed." >&2
  # Put back whatever was running; a service that did not exist yet simply stays absent.
  for service in "${services[@]}"; do "${compose[@]}" start "$service" >/dev/null 2>&1 || true; done
  if $manage_updater; then "${compose[@]}" start updater >/dev/null 2>&1 || true; fi
  exit 2
fi
"${compose[@]}" rm --force "${services[@]}"
"${compose[@]}" up --detach --no-deps --no-build --pull never --wait --wait-timeout 240 "${services[@]}" || deploy_failed
if [[ "$role" == gateway ]]; then agent_ready || deploy_failed; fi
if $manage_updater; then
  # Recreate so a changed REMOTE_UPDATES_ENABLED or trust setting applies; it recovers interrupted jobs on start.
  { "${compose[@]}" pull updater && "${compose[@]}" up --detach --no-deps --force-recreate updater; } \
    || { echo 'Console and agent are running, but the updater did not start; remote updates are unavailable.' >&2; exit 1; }
fi
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
if [[ -n "$(env_value BROWSER_ENABLED)" ]]; then
  echo 'Note: the Browser app has been removed; delete the BROWSER_ENABLED line from .env.'
fi
