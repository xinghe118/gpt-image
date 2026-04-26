#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/gpt-image}"
APP_PORT="${APP_PORT:-3000}"
APP_IMAGE="${APP_IMAGE:-ghcr.io/xinghe118/gpt-image:latest}"
POSTGRES_DB="${POSTGRES_DB:-gpt_image}"
POSTGRES_USER="${POSTGRES_USER:-gpt_image}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
GPT_IMAGE_AUTH_KEY="${GPT_IMAGE_AUTH_KEY:-}"
GPT_IMAGE_BASE_URL="${GPT_IMAGE_BASE_URL:-}"

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

generate_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return
  fi
  tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32
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

  if [ -z "$POSTGRES_PASSWORD" ]; then
    POSTGRES_PASSWORD="$(generate_password)"
  fi

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
    container_name: gpt-image-postgres
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
  log "Starting GPT Image..."
  docker compose -f "$APP_DIR/docker-compose.yml" up -d
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
  write_files
  start_stack
  print_done
}

main "$@"
