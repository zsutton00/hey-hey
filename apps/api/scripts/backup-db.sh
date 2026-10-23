#!/bin/bash

# Database backup script
# Usage: ./scripts/backup-db.sh [description]

set -e

BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)
DESCRIPTION=${1:-"manual"}
BACKUP_FILE="$BACKUP_DIR/backup_${DATE}_${DESCRIPTION}.dump.gz"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Prefer PROJECT_DATABASE_URL but fall back to DATABASE_URL for convenience
DATABASE_URL="${PROJECT_DATABASE_URL:-$DATABASE_URL}"

SCHEMA_NAME=$(echo "$DATABASE_URL" | sed -n 's/.*[?&]schema=\([^&]*\).*/\1/p')
if [ -z "$SCHEMA_NAME" ]; then
    SCHEMA_NAME="public"
fi

if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: PROJECT_DATABASE_URL or DATABASE_URL environment variable not set"
    echo "Make sure your .env file contains the database URL"
    exit 1
fi

echo "🗄️  Creating database backup..."
echo "📅 Date: $(date)"
echo "📝 Description: $DESCRIPTION"
echo "📁 File: $BACKUP_FILE"

# Strip schema parameter from URL for pg utilities (they don't understand this parameter)
PG_DUMP_URL=$(echo "$DATABASE_URL" | sed 's/[?&]schema=[^&]*//g')

# Create compressed backup using custom format (works with pg_restore)
if pg_dump --format=custom --no-owner --no-privileges --schema="$SCHEMA_NAME" "$PG_DUMP_URL" | gzip > "$BACKUP_FILE"; then
    echo "✅ Backup created successfully!"
    
    # Show backup size
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "💾 Backup size: $BACKUP_SIZE"
    
    # Clean up old backups (keep last 10)
    echo "🧹 Cleaning up old backups (keeping last 10)..."
    ls -t "$BACKUP_DIR"/backup_*.dump.gz 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
    
    # Show remaining backups
    BACKUP_COUNT=$(ls "$BACKUP_DIR"/backup_*.dump.gz 2>/dev/null | wc -l | tr -d ' ')
    echo "📚 Total backups stored: $BACKUP_COUNT"
    
    echo "🎉 Backup completed: $BACKUP_FILE"
else
    echo "❌ Backup failed!"
    exit 1
fi
