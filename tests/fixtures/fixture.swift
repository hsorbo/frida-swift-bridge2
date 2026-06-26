// Controlled Swift module the bridge introspects in tests. Grown per pillar;
// keep additions minimal and named for what they exercise.

// 4 words: at the calling-convention loadable boundary, but already out-of-line
// for value-buffer storage (> 3 words).
public struct LoadableStruct {
    public let a: Int
    public let b: Int
    public let c: Int
    public let d: Int
}

// 5 words: passed indirectly by the calling convention, stored out-of-line.
public struct BigStruct {
    public let a: Int
    public let b: Int
    public let c: Int
    public let d: Int
    public let e: Int
}

public func makeLoadableStruct() -> LoadableStruct {
    return LoadableStruct(a: 1, b: 2, c: 3, d: 4)
}

public func makeBigStruct() -> BigStruct {
    return BigStruct(a: 1, b: 2, c: 3, d: 4, e: 5)
}
