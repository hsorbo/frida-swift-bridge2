#!/bin/sh
# Compiles the Swift test fixtures in this directory into loadable dylibs and
# writes their absolute paths to paths.ts (gitignored) for the injected agent to
# Module.load(). Always emits paths.ts so the test bundle resolves; when no Swift
# toolchain is present it writes empty paths and the loaders fail at Module.load.
set -e

fixtures="$(cd "$(dirname "$0")" && pwd)"
paths="$fixtures/paths.ts"

emit_paths() {
  printf 'export const FIXTURE_DYLIB = "%s";\nexport const RESILIENT_DYLIB = "%s";\n' "$1" "$2" >"$paths"
}

if ! command -v swiftc >/dev/null 2>&1; then
  echo "build fixtures: swiftc not found; skipping Swift fixture build"
  emit_paths "" ""
  exit 0
fi

fixture_out="$fixtures/fixture.dylib"
resilient_out="$fixtures/resilient.dylib"

swiftc -emit-library -module-name fixture "$fixtures/fixture.swift" -o "$fixture_out"
codesign -s - -f "$fixture_out"

swiftc -emit-library -enable-library-evolution -module-name resilient "$fixtures/resilient.swift" -o "$resilient_out"
codesign -s - -f "$resilient_out"

emit_paths "$fixture_out" "$resilient_out"
