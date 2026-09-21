#!/usr/bin/env bash
# Throwaway (remote-releases.md step 6): print what the cache is about to hold, as one
# annotation, so "Cache save failed" can be read without the job logs (10 GB is the repo's
# whole budget). Deleted with .github/workflows/measure.yml.
set -uo pipefail

platform="$1"
case "$platform" in
  ios) paths=(apps/mobile/ios "$HOME/Library/Caches/CocoaPods" "$HOME/.expo") ;;
  android) paths=(apps/mobile/android "$HOME/.gradle/caches" "$HOME/.gradle/wrapper" "$HOME/.expo") ;;
  *) echo "usage: measure-cache.sh <ios|android>" >&2; exit 2 ;;
esac

lines=""
for path in "${paths[@]}"; do
  if [ -e "$path" ]; then
    lines+="$(du -sh "$path" 2>/dev/null | head -1)"$'\n'
  else
    lines+="(absent) $path"$'\n'
  fi
done
total="$(du -sc "${paths[@]}" 2>/dev/null | tail -1 | cut -f1)"
lines+="total ${total:-unknown} KB"

# Why a save fails is in the job log, which needs a login — but the archive step is `tar`,
# and its complaint is not. Write one to /dev/null and keep whatever it says.
tar_err="$(tar -cf /dev/null "${paths[@]}" 2>&1 >/dev/null | head -5)"
lines+=$'\n'"tar: ${tar_err:-ok}"

printf '%s\n' "$lines"
echo "::notice title=${platform} cache::$(printf '%s' "$lines" | awk '{printf "%s%%0A", $0}')"
