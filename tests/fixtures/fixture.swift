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

extension LoadableStruct {
    public func dot(_ k: Int) -> Int { (a + b + c + d) * k }
}

extension BigStruct {
    public func total() -> Int { a + b + c + d + e }
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

// Value-type methods. self routing: mutating/large → x20 pointer; small non-mutating → trailing arg.
public struct Accumulator {
    public var total: Int
    public mutating func add(_ amount: Int) {
        total += amount
    }
    public func peek(_ x: Int) -> Int { total + x }
    public func describe(_ prefix: String) -> String { "\(prefix): \(total)" }
    public static func zero() -> Accumulator { Accumulator(total: 0) }
    public static func summing(_ a: Int, _ b: Int) -> Int { a + b }
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

// Generic value args pass indirectly; wrappers drive them so the hook side can observe a call.
@inline(never)
public func genericIdentity<T>(_ x: T) -> T {
    return x
}

public func makeGenericInt() -> Int {
    return genericIdentity(7)
}

public func makeGenericStruct() -> LoadableStruct {
    return genericIdentity(LoadableStruct(a: 5, b: 6, c: 7, d: 8))
}

@inline(never)
public func genericFirst<A, B>(_ a: A, _ b: B) -> A {
    return a
}

public func makeGenericPair() -> Int {
    return genericFirst(11, "ignored")
}

// Constrained generic: the requirement dispatches through the appended witness table.
public protocol Scalable {
    func scaled(by factor: Int) -> Int
}

extension Int: Scalable {
    public func scaled(by factor: Int) -> Int { self * factor }
}

@inline(never)
public func scaleGeneric<T: Scalable>(_ x: T, by factor: Int) -> Int {
    return x.scaled(by: factor)
}

// Generic instance methods: self in x20, generic args indirect, type metadata + witness tables trail the args.
public final class Box {
    public init() {}
    public func echo<T>(_ x: T) -> T { x }
    public func pick<A, B>(_ a: A, _ b: B) -> A { a }
    public func scaled<T: Scalable>(_ x: T, by k: Int) -> Int { x.scaled(by: k) }
}

public func makeScaleGeneric() -> Int {
    return scaleGeneric(6, by: 7)
}

// store* fills a caller buffer (no by-value existential return); *Type exposes the unnameable
// existential metadata.
public func storeAnyInt(_ p: UnsafeMutableRawPointer) {
    p.assumingMemoryBound(to: Any.self).initialize(to: 42)
}

public func storeAnyBig(_ p: UnsafeMutableRawPointer) {
    p.assumingMemoryBound(to: Any.self).initialize(to: BigStruct(a: 1, b: 2, c: 3, d: 4, e: 5))
}

public protocol Greeter {
    func greet() -> String
}

public struct PoliteGreeter: Greeter {
    public let name: String
    public func greet() -> String { "Hello, \(name)" }
}

public func storeGreeter(_ p: UnsafeMutableRawPointer) {
    p.assumingMemoryBound(to: (any Greeter).self).initialize(to: PoliteGreeter(name: "Ada"))
}

public protocol Named: AnyObject {
    var label: String { get }
}

public final class Widget: Named {
    public let label: String
    public init(label: String) { self.label = label }
}

public func storeNamed(_ p: UnsafeMutableRawPointer) {
    p.assumingMemoryBound(to: (any Named).self).initialize(to: Widget(label: "Bee"))
}

public struct CodedError: Error {
    public let code: Int
}

public func storeError(_ p: UnsafeMutableRawPointer) {
    p.assumingMemoryBound(to: (any Error).self).initialize(to: CodedError(code: 7))
}

public enum Pick {
    case empty
    case value(Int)
    public static func tag(_ n: Int) -> Int { n * 2 }
}

public final class Counter {
    public var count: Int
    public init(count: Int) { self.count = count }
}

public func makeCounter(_ n: Int) -> Counter { Counter(count: n) }

public class Base { public let kind: Int; public init(kind: Int) { self.kind = kind } }
public final class Derived: Base { public init() { super.init(kind: 99) } }
public func makeDerivedAsBase() -> Base { Derived() }

@inline(never)
public func roundOptional<A>(_ x: A?) -> A? { x }
public func triggerRoundOptional() -> Int { roundOptional(Optional<Int>.some(9)) ?? -1 }

public final class Token {
    public let id: Int
    public init(id: Int) { self.id = id }
}
// token + 4 Ints = 40 bytes > MAX_LOADABLE → passed indirectly, and non-POD (holds a class ref).
public struct Wrapper {
    public var token: Token
    public var a: Int
    public var b: Int
    public var c: Int
    public var d: Int
}
extension Wrapper {
    public static func make(_ t: Token) -> Wrapper { Wrapper(token: t, a: 1, b: 2, c: 3, d: 4) }
}
public func makeToken(_ id: Int) -> Token { Token(id: id) }
public func makeWrapper(_ t: Token) -> Wrapper { Wrapper(token: t, a: 1, b: 2, c: 3, d: 4) }
@inline(never)
public func consumeWrapper(_ w: __owned Wrapper) -> Int { w.token.id }

public struct DoublePair { public var x: Double; public var y: Double }
public func makeDoublePair() -> DoublePair { DoublePair(x: 1.5, y: 2.5) }
public func sumDoublePair(_ p: DoublePair) -> Double { p.x + p.y }

public struct DoubleQuad { public var a: Double; public var b: Double; public var c: Double; public var d: Double }
public func makeDoubleQuad() -> DoubleQuad { DoubleQuad(a: 1, b: 2, c: 3, d: 4) }
public func sumDoubleQuad(_ q: DoubleQuad) -> Double { q.a + q.b + q.c + q.d }

public struct FloatPair { public var u: Float; public var v: Float }
public func makeFloatPair() -> FloatPair { FloatPair(u: 1.25, v: 3.75) }
public func sumFloatPair(_ p: FloatPair) -> Float { p.u + p.v }

public func boxAnyInt(_ n: Int) -> Any { n }
public func unboxAnyInt(_ x: Any) -> Int { x as! Int }
public func makeGreeterExistential() -> any Greeter { PoliteGreeter(name: "Ada") }
public func greetExistential(_ g: any Greeter) -> String { g.greet() }

public protocol Aged { var age: Int { get } }
public struct Person: Greeter, Aged {
    public let name: String
    public let age: Int
    public func greet() -> String { "Hi, \(name)" }
}
public func makeGreeterAged() -> any Greeter & Aged { Person(name: "Cy", age: 9) }
public func describeGreeterAged(_ v: any Greeter & Aged) -> String { "\(v.greet()) (\(v.age))" }

// Method invocation: String/labelled/void/static methods, a class arg, an arity overload, a computed property.
public final class Robot {
    public var name: String
    public init(name: String) { self.name = name }
    public func greet(_ who: String) -> String { "Hello \(who), I am \(name)" }
    public func rename(to newName: String) { name = newName }
    public static func make(name: String) -> Robot { Robot(name: name) }
    public func merged(with other: Robot) -> String { "\(name)+\(other.name)" }
    public func at(_ x: Int) -> Int { x }
    public func at(_ x: Int, _ y: Int) -> Int { x + y }
    public func move(to step: Int) -> Int { step }
    public func move(by step: Int) -> Int { step * 10 }
    public func tagged(_ x: Int) -> String { "int:\(x)" }
    public func tagged(_ x: String) -> String { "str:\(x)" }
    public var badge: String {
        get { "[\(name)]" }
        set { name = newValue }
    }
}

// Non-final so pub/hidden get vtable slots; hidden is internal (absent from the export trie).
public class Dispatcher {
    public init() {}
    public func pub(_ x: Int) -> Int { x + 1 }
    func hidden(_ x: Int) -> Int { x * 3 }
}

// Generic: trips readVTable's not-fixed-offset guard.
public class GenericHolder<T> {
    public init() {}
    public func stored() -> Int { 0 }
}

// Inheritance + live polymorphic dispatch. Animal is non-final so speak/legs take vtable slots;
// Cat overrides speak (filling Animal's slot in Cat's metadata) and inherits legs unchanged.
public class Animal {
    public init() {}
    public func speak() -> Int { 1 }
    public func legs() -> Int { 4 }
}
public final class Cat: Animal {
    public override init() { super.init() }
    public override func speak() -> Int { 9 }
}

public func anyType() -> UnsafeRawPointer { unsafeBitCast(Any.self, to: UnsafeRawPointer.self) }
public func greeterType() -> UnsafeRawPointer { unsafeBitCast((any Greeter).self, to: UnsafeRawPointer.self) }
public func greeterAgedType() -> UnsafeRawPointer { unsafeBitCast((any Greeter & Aged).self, to: UnsafeRawPointer.self) }
public func namedType() -> UnsafeRawPointer { unsafeBitCast((any Named).self, to: UnsafeRawPointer.self) }
public func errorType() -> UnsafeRawPointer { unsafeBitCast((any Error).self, to: UnsafeRawPointer.self) }
