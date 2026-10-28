#!/usr/bin/env sh
set -e

APP_DIR="/opt/app"
SRC_LIB="$APP_DIR/src/lib"
DIST_LIB="$APP_DIR/dist/lib"

mkdir -p "$SRC_LIB"
mkdir -p "$DIST_LIB"

if [ -n "$MODULES" ]; then
  echo "Requested modules: $MODULES"
  IFS=','

  for repo in $MODULES; do
    CLEAN_REPO=$(echo "$repo" | cut -d'#' -f1)
    NAME=$(basename "$CLEAN_REPO")
    VERSION=$(echo "$repo" | grep -o '#.*' | sed 's/#//')

    SRC_DEST="$SRC_LIB/$NAME"
    DIST_DEST="$DIST_LIB/$NAME"

    # -----------------------------
    # 1️⃣ Download source if missing
    # -----------------------------
    if [ -d "$SRC_DEST" ]; then
      echo "✔ Module $NAME already downloaded"
    else
      echo "⬇ Downloading module: $NAME"
      git clone --depth=1 "https://github.com/$CLEAN_REPO.git" "$SRC_DEST"

      if [ -n "$VERSION" ]; then
        git -C "$SRC_DEST" fetch --tags
        git -C "$SRC_DEST" checkout "$VERSION"
      fi
    fi

    # -----------------------------
    # 2️⃣ Install plugin dependencies (isolated)
    # -----------------------------
    if [ -f "$SRC_DEST/package.json" ] && [ ! -d "$SRC_DEST/node_modules" ]; then
      echo "📦 Installing dependencies for $NAME (isolated)"
      cd "$SRC_DEST"
      npm install --production
      cd "$APP_DIR"
    fi

    # -----------------------------
    # 3️⃣ Build or copy plugin
    # -----------------------------
    if [ -f "$DIST_DEST/.built" ]; then
      echo "🏁 Plugin $NAME already built"
      continue
    fi

    echo "🔧 Building plugin: $NAME"
    mkdir -p "$DIST_DEST"

    # TypeScript project
    if [ -f "$SRC_DEST/tsconfig.json" ]; then
      npx tsc --project "$SRC_DEST/tsconfig.json" --outDir "$DIST_DEST"

    # Single TS file
    elif [ -f "$SRC_DEST/index.ts" ]; then
      npx tsc "$SRC_DEST/index.ts" --outDir "$DIST_DEST"

    # Plain JS project
    else
      cp -r "$SRC_DEST"/* "$DIST_DEST/"
    fi

    # -----------------------------
    # 4️⃣ Copy plugin's node_modules to dist
    # -----------------------------
    if [ -d "$SRC_DEST/node_modules" ]; then
      echo "📦 Copying isolated dependencies for $NAME"
      cp -r "$SRC_DEST/node_modules" "$DIST_DEST/"
    fi

    # Mark as built to avoid rebuilding every restart
    touch "$DIST_DEST/.built"
  done
fi

exec "$@"
