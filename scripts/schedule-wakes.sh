#!/bin/bash
# Schedule pmset wakes 2 minutes before each cron job
# Run once daily (or after reboot) to set up all wakes for the next 24h
#
# Cron schedule to call this daily:
#   0 0 * * * /Users/louis/opencode/setting-engine/scripts/schedule-wakes.sh

# Clear any previous scheduled wakes from this script
pmset -g sched 2>/dev/null | grep -q "wake" && sudo /usr/bin/pmset repeat cancel 2>/dev/null

# Get tomorrow's date for overnight jobs
TODAY=$(date +%m/%d/%Y)
TOMORROW=$(date -v+1d +%m/%d/%Y)

# Schedule wakes 2 min before each cron:
# - 8h-18h (every hour) for send_queued
# - 23h30 for harvest

HOURS="07:58 08:58 09:58 10:58 11:58 12:58 13:58 14:58 15:58 16:58 17:58 23:28"

for TIME in $HOURS; do
    HOUR=${TIME%%:*}
    # Use tomorrow for times already passed today
    NOW_HOUR=$(date +%H%M)
    SCHED_HOUR=$(echo "$TIME" | tr -d ':')

    if [ "$SCHED_HOUR" -gt "$NOW_HOUR" ]; then
        DATE="$TODAY"
    else
        DATE="$TOMORROW"
    fi

    sudo /usr/bin/pmset schedule wake "$DATE $TIME:00"
    echo "Scheduled wake: $DATE $TIME"
done

echo "All wakes scheduled. Check with: pmset -g sched"
