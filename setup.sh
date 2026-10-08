#!/bin/sh
# Sets up Solstack on a server, or updates an existing installation.
#
#   First run:   asks for the domain and the first admin, writes .env, builds and starts everything.
#   Later runs:  rebuilds and restarts with the current code (run `git pull` first).
#
# Only nginx is reachable from outside, on port 80. Put Cloudflare (SSL mode "Flexible") in front of it.
set -eu
cd "$(dirname "$0")"

fail() {
  printf '\nError: %s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install it with: curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || fail "Docker Compose is missing. Install the docker-compose-plugin package."

hex_secret() { od -An -N24 -tx1 /dev/urandom | tr -d ' \n'; }
base64_key() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }
env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }

first_run=false
if [ -f .env ] && [ -n "$(env_value DOMAIN)" ]; then
  echo "Updating the existing installation for $(env_value DOMAIN)."
elif [ -f .env ] && env_value BASE_URL | grep -q '^https://'; then
  # An .env written by hand before this script existed: keep its secrets, add the domain.
  domain=$(env_value BASE_URL | sed -e 's|^https://||' -e 's|/.*$||')
  echo "Found an existing .env for $domain. Keeping its keys."
  printf '\nDOMAIN=%s\n' "$domain" >>.env
  [ -n "$(env_value ENCRYPTION_KEY)" ] || printf 'ENCRYPTION_KEY=%s\n' "$(base64_key)" >>.env
  [ -n "$(env_value POSTGRES_PASSWORD)" ] || printf 'POSTGRES_PASSWORD=%s\n' "$(hex_secret)" >>.env
  first_run=true
elif [ -f .env ]; then
  fail ".env exists but does not look like a server configuration (no DOMAIN or https BASE_URL). Rename it and run this again."
else
  printf 'Domain for Solstack (e.g. solstack.example.com): '
  read -r domain
  domain=$(printf '%s' "$domain" | sed -e 's|^https*://||' -e 's|/.*$||')
  [ -n "$domain" ] || fail "A domain is required."
  umask 077
  {
    echo "# Written by setup.sh. Back this file up: ENCRYPTION_KEY protects stored tokens and secrets."
    echo "DOMAIN=$domain"
    echo "ENCRYPTION_KEY=$(base64_key)"
    echo "POSTGRES_PASSWORD=$(hex_secret)"
  } >.env
  first_run=true
fi
chmod 600 .env

if [ "$first_run" = true ]; then
  printf 'Email of the first admin: '
  read -r admin_email
  printf 'Name of the first admin: '
  read -r admin_name
  [ -n "$admin_email" ] || fail "An admin email is required."
fi

printf "\nBuilding and starting (the first build takes a few minutes)...\n"
docker compose up -d --build --wait

if [ "$first_run" = true ]; then
  echo
  docker compose exec -T app node server/dist/cli.js create-admin "$admin_email" "${admin_name:-}" ||
    echo "Could not create the admin. If it already exists, get a new link with: docker compose exec app node server/dist/cli.js reset-link $admin_email"
fi

domain=$(env_value DOMAIN)
cat <<EOF

Solstack is running on port 80. In Cloudflare, for $domain:
  1. DNS: an A record for $domain pointing to this server's IP, with the proxy on (orange cloud).
  2. SSL/TLS: encryption mode "Flexible", and "Always Use HTTPS" on.
  3. Security: do not put bot challenges on /mcp or /api/v1; the solstack CLI and agents call them.

Then open https://$domain. Keep a copy of .env somewhere safe.
To update later: git pull && ./setup.sh
EOF
