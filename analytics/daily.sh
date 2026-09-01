#!/bin/bash
# =========================================================================
# daily.sh — the once-a-day visitor update.
#
# Run by launchd at 6pm Pacific (see com.sahibachopra.site-analytics.plist).
# Regenerates the visual report and shows a macOS notification with the
# headline. Nothing leaves this machine.
#
# Run it by hand any time:  ./daily.sh
# =========================================================================
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$DIR/daily.log"

# launchd starts jobs with a minimal PATH that has neither node nor aws.
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/anaconda3/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# The AWS CLI needs to find the credentials file when there is no login shell.
export HOME="${HOME:-/Users/sahibachopra}"

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S %Z') ==="

  SUMMARY="$(cd "$DIR" && node report.mjs --summary 2>&1 | tail -1)"
  STATUS=$?

  if [ $STATUS -ne 0 ] || [ -z "$SUMMARY" ]; then
    echo "report failed: $SUMMARY"
    osascript -e 'display notification "Could not read the analytics table. See analytics/daily.log." with title "sahibachopra.com" subtitle "Daily update failed"' 2>/dev/null
    exit 1
  fi

  echo "summary: $SUMMARY"

  # Refresh the visual report so it is current whenever it gets opened.
  (cd "$DIR" && node report.mjs --days 30 --html --no-open >/dev/null 2>&1) \
    && echo "report.html refreshed" || echo "report.html refresh failed"

  # Quote-safe: AppleScript strings break on embedded double quotes.
  SAFE="${SUMMARY//\"/\'}"
  osascript -e "display notification \"$SAFE\" with title \"sahibachopra.com\" subtitle \"Last 24 hours\"" 2>/dev/null \
    && echo "notified" || echo "notification failed"

} >> "$LOG" 2>&1

# Keep the log from growing without bound.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then
  tail -500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
