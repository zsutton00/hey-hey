#!/bin/bash

# List available database backups
# Usage: ./scripts/list-backups.sh

BACKUP_DIR="./backups"

echo "📚 Available Database Backups"
echo "=============================="

if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A "$BACKUP_DIR"/backup_*.dump.gz 2>/dev/null)" ]; then
    echo "No backups found in $BACKUP_DIR/"
    echo ""
    echo "💡 Create a backup with: pnpm db:backup"
    exit 0
fi

echo ""
echo "Date/Time           Description    Size    File"
echo "----------------    -----------    ----    ----"

for backup in $(ls -t "$BACKUP_DIR"/backup_*.dump.gz 2>/dev/null); do
    filename=$(basename "$backup")
    
    # Extract date and description from filename
    # Format: backup_YYYYMMDD_HHMMSS_description.dump.gz
    if [[ $filename =~ backup_([0-9]{8})_([0-9]{6})_(.+)\.dump\.gz ]]; then
        date_part="${BASH_REMATCH[1]}"
        time_part="${BASH_REMATCH[2]}"
        description="${BASH_REMATCH[3]}"
        
        # Format date as YYYY-MM-DD
        formatted_date="${date_part:0:4}-${date_part:4:2}-${date_part:6:2}"
        # Format time as HH:MM:SS
        formatted_time="${time_part:0:2}:${time_part:2:2}:${time_part:4:2}"
        
        size=$(du -h "$backup" | cut -f1)
        
        printf "%-19s %-12s %-7s %s\n" "$formatted_date $formatted_time" "$description" "$size" "$filename"
    else
        # Fallback for any backups that don't match the expected format
        size=$(du -h "$backup" | cut -f1)
        printf "%-19s %-12s %-7s %s\n" "Unknown" "Unknown" "$size" "$filename"
    fi
done

echo ""
echo "💡 Restore a backup with: pnpm db:restore <filename>"
echo "📁 Backup location: $BACKUP_DIR"
