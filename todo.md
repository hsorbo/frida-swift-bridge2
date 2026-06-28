# TODO

- `$protocols` skips conformance records whose `protocol` field is null (externally-defined
  weak protocol symbols). The old bridge recovered those by parsing the conformance
  descriptor's mangled symbol name. Add that fallback when a real case needs it.
  See `conformingProtocols` in `src/abi/protocol-conformance.ts`.
