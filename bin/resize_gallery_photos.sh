#!/usr/bin/env bash
#
# Shrink oversized travel photos in assets/img/gallery/ before they reach git.
#
# The site never displays an image wider than 1400px, so a 5000px phone photo is
# storage you pay for in the repo, in the GitHub Pages 1 GB budget, and in the
# 10-minute Pages build every single time it runs. This resizes anything larger
# than it needs to be, in place.
#
# It also bakes in EXIF rotation, so portrait photos cannot come out sideways
# in the generated WebP copies.
#
# Usage
#   bin/resize_gallery_photos.sh              scan every photo in the gallery
#   bin/resize_gallery_photos.sh --staged     only photos staged for commit
#   bin/resize_gallery_photos.sh --check      report what would change, touch nothing
#   bin/resize_gallery_photos.sh --install-hook
#                                             run it automatically on every commit
#
# Untouched originals are copied to .photo-originals/ first. That folder is
# git-ignored, so it never leaves your machine, and nothing is destroyed.

set -euo pipefail

MAX_EDGE=2000          # px on the long side; the site tops out at 1400
MAX_BYTES=$((1536*1024))  # 1.5 MB
QUALITY=85
MARKER="gallery-resized"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GALLERY="$ROOT/assets/img/gallery"
BACKUP="$ROOT/.photo-originals"

MODE="all"
case "${1:-}" in
  --staged) MODE="staged" ;;
  --check)  MODE="check" ;;
  --install-hook) MODE="install" ;;
  "") ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac

# ---------------------------------------------------------------- install hook
if [ "$MODE" = "install" ]; then
  HOOK="$ROOT/.git/hooks/pre-commit"
  cat > "$HOOK" <<'HOOK_BODY'
#!/usr/bin/env bash
# Installed by bin/resize_gallery_photos.sh --install-hook
exec "$(git rev-parse --show-toplevel)/bin/resize_gallery_photos.sh" --staged
HOOK_BODY
  chmod +x "$HOOK"
  echo "Installed $HOOK"
  echo "Gallery photos will now be resized automatically when you commit them."
  exit 0
fi

if ! command -v magick >/dev/null 2>&1; then
  echo "resize_gallery_photos: ImageMagick (magick) not found, skipping." >&2
  exit 0
fi

[ -d "$GALLERY" ] || exit 0

# ------------------------------------------------------------------ file list
files=()
if [ "$MODE" = "staged" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] && [ -f "$ROOT/$f" ] && files+=("$ROOT/$f")
  done < <(git -C "$ROOT" diff --cached --name-only --diff-filter=ACMR \
            -- 'assets/img/gallery/*.jpg' 'assets/img/gallery/*.jpeg' \
               'assets/img/gallery/*.JPG' 'assets/img/gallery/*.JPEG' \
               'assets/img/gallery/*.png' 'assets/img/gallery/*.PNG' 2>/dev/null || true)
else
  while IFS= read -r f; do
    files+=("$f")
  done < <(find "$GALLERY" -type f \
            \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) | sort)
fi

[ ${#files[@]} -eq 0 ] && exit 0

# ------------------------------------------------------------------- the work
changed=0
before_total=0
after_total=0

for f in "${files[@]}"; do
  bytes=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
  read -r w h comment < <(magick identify -format '%w %h %c\n' "$f[0]" 2>/dev/null | head -1)
  [ -z "${w:-}" ] && continue
  edge=$(( w > h ? w : h ))

  # Already processed once and within budget: leave it alone, so repeated runs
  # cannot re-encode the same file down to mush.
  if [ "${comment:-}" = "$MARKER" ] && [ "$edge" -le "$MAX_EDGE" ]; then
    continue
  fi
  if [ "$edge" -le "$MAX_EDGE" ] && [ "$bytes" -le "$MAX_BYTES" ]; then
    continue
  fi

  rel="${f#"$ROOT"/}"
  if [ "$MODE" = "check" ]; then
    printf '  would resize  %-58s %sx%s  %.2f MB\n' "$rel" "$w" "$h" "$(echo "scale=2; $bytes/1048576" | bc)"
    changed=$((changed+1))
    continue
  fi

  # Keep an untouched copy outside git before rewriting anything.
  dest="$BACKUP/$rel"
  if [ ! -f "$dest" ]; then
    mkdir -p "$(dirname "$dest")"
    cp -p "$f" "$dest"
  fi

  tmp="$(mktemp "${TMPDIR:-/tmp}/gallery-resize.XXXXXX")"
  magick "$f" -auto-orient -strip \
    -resize "${MAX_EDGE}x${MAX_EDGE}>" -quality "$QUALITY" \
    -set comment "$MARKER" "${f##*.}:$tmp"
  mv "$tmp" "$f"

  after=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
  nw=$(magick identify -format '%wx%h' "$f[0]")
  printf '  resized  %-52s %.2f MB -> %.2f MB  (%s)\n' \
    "$rel" "$(echo "scale=2; $bytes/1048576" | bc)" \
    "$(echo "scale=2; $after/1048576" | bc)" "$nw"

  before_total=$((before_total + bytes))
  after_total=$((after_total + after))
  changed=$((changed+1))

  # A pre-commit run has to re-stage what it just rewrote.
  [ "$MODE" = "staged" ] && git -C "$ROOT" add -- "$rel"
done

if [ "$changed" -gt 0 ] && [ "$MODE" != "check" ]; then
  printf '  %s photo(s) resized, %.1f MB saved. Originals kept in .photo-originals/\n' \
    "$changed" "$(echo "scale=1; ($before_total-$after_total)/1048576" | bc)"
fi
exit 0
