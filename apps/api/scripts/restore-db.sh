#!/bin/bash

# Database restore script
# Usage: ./scripts/restore-db.sh <backup-file>

set -e

BACKUP_FILE="$1"

if [ -z "$BACKUP_FILE" ]; then
    echo "❌ Error: Please specify a backup file"
    echo "Usage: $0 <backup-file>"
    echo ""
    echo "Available backups:"
    ls -la ./backups/backup_*.dump.gz 2>/dev/null || echo "No backups found in ./backups/"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Error: Backup file '$BACKUP_FILE' not found"
    exit 1
fi

# Prefer PROJECT_DATABASE_URL but fall back to DATABASE_URL
DATABASE_URL="${PROJECT_DATABASE_URL:-$DATABASE_URL}"

if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: PROJECT_DATABASE_URL or DATABASE_URL environment variable not set"
    echo "Make sure your .env file contains the database URL"
    exit 1
fi

echo "⚠️  WARNING: This will COMPLETELY REPLACE the current database!"
echo "📁 Backup file: $BACKUP_FILE"
echo "🗄️  Target database: $DATABASE_URL"
echo ""
read -p "Are you sure you want to continue? (y/N): " confirm

if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "❌ Restore cancelled"
    exit 1
fi

SANITIZED_URL=$(echo "$DATABASE_URL" | sed 's/[?&]schema=[^&]*//g')
SCHEMA_NAME=$(echo "$DATABASE_URL" | sed -n 's/.*[?&]schema=\([^&]*\).*/\1/p')
if [ -z "$SCHEMA_NAME" ]; then
    SCHEMA_NAME="temp"
fi

bash scripts/preserve-organization-deletion-markers.sh capture "$SANITIZED_URL" "$SCHEMA_NAME"

echo "🗑️  Dropping current database schema '$SCHEMA_NAME'..."
psql "$SANITIZED_URL" -c "DROP SCHEMA IF EXISTS \"$SCHEMA_NAME\" CASCADE; CREATE SCHEMA \"$SCHEMA_NAME\"; CREATE EXTENSION IF NOT EXISTS \"pg_trgm\" SCHEMA \"$SCHEMA_NAME\";" >/dev/null

echo "📥 Restoring database from backup..."
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
gunzip -c "$BACKUP_FILE" > "$TMPDIR/restore.dump"

# Run pg_restore and capture exit code. Allow 0 (success) or 1 (warnings like 'schema already exists')
set +e
pg_restore --no-owner --no-privileges --dbname="$SANITIZED_URL" "$TMPDIR/restore.dump" >/dev/null 2>&1
RESTORE_EXIT_CODE=$?
set -e

if [ $RESTORE_EXIT_CODE -eq 0 ] || [ $RESTORE_EXIT_CODE -eq 1 ]; then
    pnpm db:flyway:migrate
    bash scripts/preserve-organization-deletion-markers.sh apply "$SANITIZED_URL" "$SCHEMA_NAME"
    echo "✅ Database restored successfully!"
    echo "🔄 Regenerating Prisma client..."
    pnpm prisma generate
    echo "🎉 Restore completed!"
else
    echo "❌ Restore failed with exit code $RESTORE_EXIT_CODE!"
    echo "💡 You may need to run 'pnpm prisma db push --force-reset' to restore to a clean state"
    exit 1
fi
