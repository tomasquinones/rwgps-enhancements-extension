#!/bin/bash
set -e

cd "$(dirname "$0")"

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
DIST_DIR="dist"

echo "Building RideWithGPS Enhancements v${VERSION}"

# Clean previous builds
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/source"

# Files to include in the extension package
INCLUDE=(
  manifest.json
  LICENSE
  content/
  popup/
  icons/icon-16.png
  icons/icon-32.png
  icons/icon-48.png
  icons/icon-96.png
  icons/icon-128.png
)

# Copy files into staging directory
for item in "${INCLUDE[@]}"; do
  if [ -d "$item" ]; then
    mkdir -p "$DIST_DIR/source/$item"
    cp -R "$item"/* "$DIST_DIR/source/$item/"
  elif [ -f "$item" ]; then
    mkdir -p "$DIST_DIR/source/$(dirname "$item")"
    cp "$item" "$DIST_DIR/source/$item"
  else
    echo "Warning: $item not found, skipping"
  fi
done

# Remove .DS_Store files
find "$DIST_DIR/source" -name '.DS_Store' -delete 2>/dev/null || true

# Build Firefox package (.xpi is just a zip)
cd "$DIST_DIR/source"
zip -r -q "../rwgps-enhancements-${VERSION}-firefox.zip" . -x '*.DS_Store'
cd ../..

# Build Chrome package (identical contents — Chrome ignores gecko keys)
cp "$DIST_DIR/rwgps-enhancements-${VERSION}-firefox.zip" \
   "$DIST_DIR/rwgps-enhancements-${VERSION}-chrome.zip"

# Source code archive for AMO review (full repo minus .git)
zip -r -q "$DIST_DIR/rwgps-enhancements-${VERSION}-source.zip" \
  . \
  -x '.git/*' \
  -x '.claude/*' \
  -x 'dist/*' \
  -x '.DS_Store' \
  -x '*.DS_Store'

echo ""
echo "Built packages in $DIST_DIR/:"
ls -lh "$DIST_DIR"/*.zip
echo ""
echo "Next steps:"
echo "  Firefox: Upload *-firefox.zip to https://addons.mozilla.org/developers/"
echo "  Chrome:  Upload *-chrome.zip to https://chrome.google.com/webstore/devconsole"
