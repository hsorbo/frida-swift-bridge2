#!/bin/sh
# Compiles the Swift test fixtures in this directory into loadable dylibs and
# writes their absolute paths to paths.ts (gitignored) for the injected agent to
# Module.load(). Always emits paths.ts so the test bundle resolves; when no Swift
# toolchain is present it writes empty paths and the loaders fail at Module.load.
set -e

fixtures="$(cd "$(dirname "$0")" && pwd)"
paths="$fixtures/paths.ts"

emit_paths() {
  printf 'export const FIXTURE_DYLIB = "%s";\nexport const RESILIENT_DYLIB = "%s";\nexport const FIXTURESYMS_DYLIB = "%s";\n' "$1" "$2" "$3" >"$paths"
}

if ! command -v swiftc >/dev/null 2>&1; then
  echo "build fixtures: swiftc not found; skipping Swift fixture build"
  emit_paths "" "" ""
  exit 0
fi

# fixture/resilient are stripped on both platforms, matching a real release binary; resilient
# stays unstripped until fixture/fixturesyms have linked against it. fixturesyms is the same
# source, deliberately left unstripped.
case "$(uname -s)" in
  Darwin)
    fixture_out="$fixtures/fixture.dylib"
    resilient_out="$fixtures/resilient.dylib"
    fixturesyms_out="$fixtures/fixturesyms.dylib"

    swiftc -emit-library -emit-module -enable-library-evolution -module-name resilient \
      "$fixtures/resilient.swift" -o "$resilient_out" \
      -Xlinker -install_name -Xlinker "$resilient_out"

    swiftc -emit-library -module-name fixture "$fixtures/fixture.swift" -I "$fixtures" "$resilient_out" -o "$fixture_out"
    xcrun strip -x "$fixture_out"
    codesign -s - -f "$fixture_out"

    swiftc -emit-library -module-name fixturesyms "$fixtures/fixture.swift" -I "$fixtures" "$resilient_out" -o "$fixturesyms_out"
    codesign -s - -f "$fixturesyms_out"

    xcrun strip -x "$resilient_out"
    codesign -s - -f "$resilient_out"

    emit_paths "$fixture_out" "$resilient_out" "$fixturesyms_out"
    ;;
  Linux)
    fixture_out="$fixtures/fixture.so"
    resilient_out="$fixtures/resilient.so"
    fixturesyms_out="$fixtures/fixturesyms.so"

    swiftc -emit-library -emit-module -enable-library-evolution -module-name resilient \
      "$fixtures/resilient.swift" -o "$resilient_out" \
      -Xlinker -soname -Xlinker "$resilient_out"

    swiftc -emit-library -module-name fixture "$fixtures/fixture.swift" -I "$fixtures" "$resilient_out" -o "$fixture_out"
    swiftc -emit-library -module-name fixturesyms "$fixtures/fixture.swift" -I "$fixtures" "$resilient_out" -o "$fixturesyms_out"

    # Also proves section discovery is symbol-independent.
    strip "$fixture_out" "$resilient_out"

    emit_paths "$fixture_out" "$resilient_out" "$fixturesyms_out"
    ;;
  *)
    echo "build fixtures: unsupported OS $(uname -s)" >&2
    exit 1
    ;;
esac
