#!/usr/bin/env bash
# Send readings not yet confirmed on-chain to the prover now. For each meter: its lowest 100 nonces.
# Run in the Console folder on central or a standalone Console.
#   ./prover-batch.sh              lowest 100 unconfirmed nonces per meter
#   ./prover-batch.sh --limit 250  lowest 250 per meter
#   ./prover-batch.sh --all        every unconfirmed reading (what the scheduled job sends)
set -euo pipefail
limit=100
while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit) [[ $# -ge 2 && "$2" =~ ^[1-9][0-9]*$ ]] || { echo 'Use --limit followed by a positive whole number.' >&2; exit 2; }; limit=$2; shift 2 ;;
    --all) limit=0; shift ;;
    -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (use --limit N or --all)" >&2; exit 2 ;;
  esac
done
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
exec "${args[@]}" exec -T -e PROVER_BATCH_LIMIT="$limit" console node - < scripts/prover-batch.cjs
