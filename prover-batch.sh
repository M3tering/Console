#!/usr/bin/env bash
# Send every reading not yet confirmed on-chain to the prover now (what the scheduled prover job does).
# Run in the Console folder on central or a standalone Console.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[[ -f .env ]] || { echo 'No .env here: run this in the Console folder of a deployed Console.' >&2; exit 2; }
env_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env | tail -1 \
    | sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
# Use the role's compose file: the one ./auto-compose.sh recorded, or the one CONSOLE_ROLE implies.
compose_file=$(env_value COMPOSE_FILE)
if [[ -z "$compose_file" ]]; then
  case "$(env_value CONSOLE_ROLE)" in
    central) compose_file=compose.central.yaml ;;
    gateway) compose_file=compose.gateway.yaml ;;
    *) compose_file=compose.yaml ;;
  esac
fi
project=$(env_value COMPOSE_PROJECT_NAME)
args=(docker compose -f "$compose_file")
[[ -z "$project" ]] || args+=(--project-name "$project")
[[ -n "$("${args[@]}" ps -q console 2>/dev/null)" ]] || { echo "The Console isn't running here ($compose_file). Start it with ./auto-compose.sh." >&2; exit 1; }
exec "${args[@]}" exec -T console node - < scripts/prover-batch.cjs
