// Parked for an out-of-suite PAC test: the only closure fixture built `-target arm64e`, so the call
// to `body` lowers to `blraa` and authenticates the pointer. Not built by `npm test` (that host is
// plain arm64, where PAC is inert); a live-arm64e host exercises this deliberately.
public func invokeClosure(_ body: () -> Void) {
    body()
}
