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

public func addInts(_ a: Int, _ b: Int) -> Int {
    return a + b
}

public func sumLoadable(_ s: LoadableStruct) -> Int {
    return s.a + s.b + s.c + s.d
}

public func sumBig(_ s: BigStruct) -> Int {
    return s.a + s.b + s.c + s.d + s.e
}

public func makeString() -> String {
    return "New Cairo"
}

// self in x20: a mutating method takes self by inout pointer regardless of size.
public struct Accumulator {
    public var total: Int
    public mutating func add(_ amount: Int) {
        total += amount
    }
}

public enum FixtureError: Error {
    case boom
}

public func mightThrow(_ code: Int) throws -> Int {
    if code != 0 {
        throw FixtureError.boom
    }
    return 99
}

public func scaleDouble(_ x: Double) -> Double {
    return x * 2
}

public func scaleFloat(_ x: Float) -> Float {
    return x * 2
}

public func combine(_ i: Int, _ d: Double) -> Double {
    return Double(i) + d
}

public struct Point {
    public var x: Int
    public var doubled: Int { x * 2 }
}
