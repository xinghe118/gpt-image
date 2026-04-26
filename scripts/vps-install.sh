#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/gpt-image}"
APP_PORT="${APP_PORT:-3000}"
APP_IMAGE="${APP_IMAGE:-ghcr.io/xinghe118/gpt-image:latest}"
POSTGRES_DB="${POSTGRES_DB:-gpt_image}"
POSTGRES_USER="${POSTGRES_USER:-gpt_image}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-gpt-image-postgres}"
RESET_POSTGRES_DATA="${RESET_POSTGRES_DATA:-false}"
GPT_IMAGE_AUTH_KEY="${GPT_IMAGE_AUTH_KEY:-}"
GPT_IMAGE_BASE_URL="${GPT_IMAGE_BASE_URL:-}"
POSTGRES_RESET_DONE="false"

log() {
  printf '\033[1;36m[gpt-image]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[gpt-image]\033[0m %s\n' "$*" >&2
  exit 1
}

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fail "Please run as root: curl -fsSL ... | sudo bash"
  fi
}

prompt_secret() {
  local var_name="$1"
  local prompt="$2"
  local current_value="${!var_name:-}"
  if [ -n "$current_value" ]; then
    return
  fi

  if [ -t 0 ]; then
    read -r -s -p "$prompt: " current_value
    printf '\n'
  elif [ -r /dev/tty ]; then
    read -r -s -p "$prompt: " current_value </dev/tty
    printf '\n' >/dev/tty
  else
    fail "$var_name is required. Pass it as an environment variable."
  fi

  if [ -z "$current_value" ]; then
    fail "$var_name cannot be empty."
  fi
  printf -v "$var_name" '%s' "$current_value"
}

prompt_optional() {
  local var_name="$1"
  local prompt="$2"
  local current_value="${!var_name:-}"
  if [ -n "$current_value" ]; then
    return
  fi

  if [ -t 0 ]; then
    read -r -p "$prompt: " current_value
  elif [ -r /dev/tty ]; then
    read -r -p "$prompt: " current_value </dev/tty
  else
    current_value=""
  fi
  printf -v "$var_name" '%s' "$current_value"
}

prompt_confirm() {
  local prompt="$1"
  local default_answer="${2:-n}"
  local answer=""
  local suffix="[y/N]"

  if [ "$default_answer" = "y" ]; then
    suffix="[Y/n]"
  fi

  if [ -t 0 ]; then
    read -r -p "$prompt $suffix: " answer
  elif [ -r /dev/tty ]; then
    read -r -p "$prompt $suffix: " answer </dev/tty
  else
    answer="$default_answer"
  fi

  answer="${answer:-$default_answer}"
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

generate_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return
  fi
  tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32
}

container_exists() {
  local container_name="$1"
  docker ps -a --format '{{.Names}}' | grep -Fxq "$container_name"
}

container_running() {
  local container_name="$1"
  docker ps --format '{{.Names}}' | grep -Fxq "$container_name"
}

reset_postgres_data() {
  log "Resetting PostgreSQL data. This deletes the existing GPT Image database."
  if [ -f "$APP_DIR/docker-compose.yml" ]; then
    docker compose -f "$APP_DIR/docker-compose.yml" down -v || true
    POSTGRES_RESET_DONE="true"
    return
  fi

  local volumes
  volumes="$(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)"
  docker rm -f "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  if [ -n "$volumes" ]; then
    while IFS= read -r volume_name; do
      if [ -n "$volume_name" ]; then
        docker volume rm "$volume_name" >/dev/null 2>&1 || true
      fi
    done <<EOF
$volumes
EOF
  fi
  POSTGRES_RESET_DONE="true"
}

should_reset_postgres_data() {
  case "$RESET_POSTGRES_DATA" in
    1|true|TRUE|yes|YES|y|Y) return 0 ;;
    *) ;;
  esac

  prompt_confirm "PostgreSQL password test failed. Delete old database data and recreate it" "n"
}

ensure_postgres_password() {
  if [ -n "$POSTGRES_PASSWORD" ]; then
    return
  fi

  if [ -t 0 ] || [ -r /dev/tty ]; then
    prompt_secret POSTGRES_PASSWORD "Enter PostgreSQL password"
    local postgres_password_confirm=""
    prompt_secret postgres_password_confirm "Confirm PostgreSQL password"
    if [ "$POSTGRES_PASSWORD" != "$postgres_password_confirm" ]; then
      fail "PostgreSQL passwords do not match. Please run the installer again."
    fi
    return
  fi

  POSTGRES_PASSWORD="$(generate_password)"
  log "POSTGRES_PASSWORD was not provided in non-interactive mode; generated a new password."
}

test_existing_postgres() {
  if ! container_exists "$POSTGRES_CONTAINER"; then
    log "No existing PostgreSQL container named $POSTGRES_CONTAINER was found. A new PostgreSQL service will be created."
    return
  fi

  log "Found existing PostgreSQL container: $POSTGRES_CONTAINER"
  if ! container_running "$POSTGRES_CONTAINER"; then
    log "Starting existing PostgreSQL container for connection test..."
    docker start "$POSTGRES_CONTAINER" >/dev/null
  fi

  log "Testing PostgreSQL connection before writing deployment files..."
  if docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select 1" >/dev/null 2>&1; then
    log "PostgreSQL connection test passed."
    return
  fi

  if should_reset_postgres_data; then
    reset_postgres_data
    return
  fi

  fail "PostgreSQL connection test failed. The password, user, or database does not match the existing container.

Fix it on the VPS, then run this installer again:
  docker compose exec postgres psql -U postgres -d postgres
  ALTER USER ${POSTGRES_USER} WITH PASSWORD 'your-password';
  \\q

Or remove the old database volume only if you do not need the old data:
  cd ${APP_DIR}
  docker compose down -v"
}

test_started_postgres() {
  log "Waiting for PostgreSQL health check..."
  for _ in $(seq 1 30); do
    if docker compose -f "$APP_DIR/docker-compose.yml" exec -T postgres \
      pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done

  log "Testing PostgreSQL connection after startup..."
  if docker compose -f "$APP_DIR/docker-compose.yml" exec -T postgres \
    env PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select 1" >/dev/null 2>&1; then
    log "PostgreSQL connection test passed."
    return
  fi

  if [ "$POSTGRES_RESET_DONE" != "true" ] && should_reset_postgres_data; then
    reset_postgres_data
    log "Recreating PostgreSQL after data reset..."
    docker compose -f "$APP_DIR/docker-compose.yml" up -d postgres
    test_started_postgres
    return
  fi

  fail "PostgreSQL started but password authentication failed. Check POSTGRES_PASSWORD and the existing postgres_data volume."
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker and Docker Compose are already installed."
    return
  fi

  log "Installing Docker..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y ca-certificates curl gnupg
    curl -fsSL https://get.docker.com | sh
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y curl
    curl -fsSL https://get.docker.com | sh
  elif command -v yum >/dev/null 2>&1; then
    yum install -y curl
    curl -fsSL https://get.docker.com | sh
  else
    fail "Unsupported system. Please install Docker manually first."
  fi

  systemctl enable --now docker >/dev/null 2>&1 || true

  if ! docker compose version >/dev/null 2>&1; then
    fail "Docker Compose plugin is not available after Docker installation."
  fi
}

write_files() {
  log "Writing deployment files to $APP_DIR"
  mkdir -p "$APP_DIR/data"
  chmod 700 "$APP_DIR"

  cat >"$APP_DIR/.env" <<EOF
GPT_IMAGE_AUTH_KEY=${GPT_IMAGE_AUTH_KEY}
GPT_IMAGE_BASE_URL=${GPT_IMAGE_BASE_URL}
STORAGE_BACKEND=postgres
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
EOF
  chmod 600 "$APP_DIR/.env"

  cat >"$APP_DIR/docker-compose.yml" <<EOF
services:
  app:
    image: ${APP_IMAGE}
    container_name: gpt-image
    restart: unless-stopped
    ports:
      - "${APP_PORT}:80"
    env_file:
      - .env
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./data:/app/data

  postgres:
    image: postgres:16-alpine
    container_name: ${POSTGRES_CONTAINER}
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
EOF
}

start_stack() {
  log "Pulling images..."
  docker compose -f "$APP_DIR/docker-compose.yml" pull
  log "Starting PostgreSQL..."
  docker compose -f "$APP_DIR/docker-compose.yml" up -d postgres
  test_started_postgres
  log "Starting GPT Image..."
  docker compose -f "$APP_DIR/docker-compose.yml" up -d app
}

print_done() {
  local public_url
  if [ -n "$GPT_IMAGE_BASE_URL" ]; then
    public_url="$GPT_IMAGE_BASE_URL"
  else
    public_url="http://YOUR_SERVER_IP:${APP_PORT}"
  fi

  cat <<EOF

GPT Image has been deployed.

App directory: $APP_DIR
URL: $public_url
Storage: PostgreSQL

Useful commands:
  cd $APP_DIR
  docker compose ps
  docker compose logs -f app
  docker compose pull && docker compose up -d
  docker compose exec postgres pg_dump -U ${POSTGRES_USER} ${POSTGRES_DB} > backup.sql

EOF
}

main() {
  need_root
  prompt_secret GPT_IMAGE_AUTH_KEY "Enter admin login key"
  prompt_optional GPT_IMAGE_BASE_URL "Enter public URL, optional, e.g. https://img.example.com"
  install_docker
  ensure_postgres_password
  test_existing_postgres
  write_files
  start_stack
  print_done
}

main "$@"
