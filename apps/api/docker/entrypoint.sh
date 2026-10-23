#!/bin/sh
set -eu

file_env() {
  var_name="$1"
  default_value="${2-}"
  required="${3-false}"
  file_var_name="${var_name}_FILE"

  var_value="$(eval "printf '%s' \"\${$var_name-}\"")"
  file_var_value="$(eval "printf '%s' \"\${$file_var_name-}\"")"

  if [ -n "$var_value" ] && [ -n "$file_var_value" ]; then
    echo "error: both $var_name and $file_var_name are set" >&2
    exit 1
  fi

  if [ -n "$file_var_value" ]; then
    if [ ! -f "$file_var_value" ]; then
      echo "error: $file_var_name points to missing file: $file_var_value" >&2
      exit 1
    fi
    var_value="$(cat "$file_var_value")"
    if [ -z "$var_value" ] && [ "$required" = true ]; then
      echo "error: $file_var_name points to an empty file: $file_var_value" >&2
      exit 1
    fi
  fi

  if [ -z "$var_value" ] && [ -n "$default_value" ]; then
    var_value="$default_value"
  fi

  export "$var_name=$var_value"
  unset "$file_var_name"
}

# Support secrets from either env vars or mounted secret files.
file_env "PROJECT_DATABASE_URL"
file_env "POSTGRES_PASSWORD" "" true
file_env "REDIS_PASSWORD" "" true
file_env "JWT_SECRET" "" true
file_env "SECRET_KEY" "" true
file_env "INTEGRATION_ENCRYPTION_KEY" "" true
file_env "TRIGGER_SIGNING_PRIVATE_KEY" "" true
file_env "CLAUDE_API_KEY"
file_env "OPENAI_API_KEY"
file_env "SYNTHETIC_LLM_API_KEY"
file_env "GITHUB_CLIENT_SECRET"
file_env "GITHUB_WEBHOOK_SECRET"
file_env "RESEND_API_KEY"
file_env "JWT_PRIVATE_KEY"
file_env "JWT_PUBLIC_KEY"

# Compose PROJECT_DATABASE_URL from split postgres env vars when needed.
if [ -z "${PROJECT_DATABASE_URL:-}" ] && [ -n "${POSTGRES_HOST:-}" ] && [ -n "${POSTGRES_USER:-}" ] && [ -n "${POSTGRES_DB:-}" ]; then
  postgres_port="${POSTGRES_PORT:-5432}"
  postgres_schema="${POSTGRES_SCHEMA:-public}"

  if [ -n "${POSTGRES_PASSWORD:-}" ]; then
    db_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${postgres_port}/${POSTGRES_DB}"
  else
    db_url="postgresql://${POSTGRES_USER}@${POSTGRES_HOST}:${postgres_port}/${POSTGRES_DB}"
  fi

  PROJECT_DATABASE_URL="${db_url}?schema=${postgres_schema}"
  export PROJECT_DATABASE_URL
fi

# Compose REDIS_URL from split redis env vars when needed.
if [ -z "${REDIS_URL:-}" ] && [ -n "${REDIS_HOST:-}" ]; then
  redis_port="${REDIS_PORT:-6379}"
  if [ -n "${REDIS_PASSWORD:-}" ]; then
    REDIS_URL="redis://:${REDIS_PASSWORD}@${REDIS_HOST}:${redis_port}"
  else
    REDIS_URL="redis://${REDIS_HOST}:${redis_port}"
  fi
  export REDIS_URL
fi

exec "$@"
