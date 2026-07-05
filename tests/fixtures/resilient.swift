// Built with -enable-library-evolution so its types use resilient layout
// (runtime field-offset resolution), which libswiftCore can't reliably provide.
// Seed for the deferred resilient-superclass / resilient-field-offset work.

public struct ResilientPoint {
    public var x: Int
    public var y: Int

    public init(x: Int, y: Int) {
        self.x = x
        self.y = y
    }
}

// non-frozen ⇒ passed @in / returned @out across the resilience boundary, despite its 16-byte size
public func translate(_ p: ResilientPoint, dx: Int, dy: Int) -> ResilientPoint {
    return ResilientPoint(x: p.x + dx, y: p.y + dy)
}

// @frozen ⇒ visible layout ⇒ direct ABI even in a resilient module (the heuristic's false-positive case)
@frozen public struct FrozenPoint {
    public var x: Int
    public var y: Int

    public init(x: Int, y: Int) {
        self.x = x
        self.y = y
    }
}

public func translateFrozen(_ p: FrozenPoint, dx: Int, dy: Int) -> FrozenPoint {
    return FrozenPoint(x: p.x + dx, y: p.y + dy)
}

// fixture.ConcreteSub subclasses this cross-module, which is what sets hasResilientSuperclass.
open class ResilientBase {
    public var tag: Int
    public init(tag: Int) { self.tag = tag }
    open func greeting() -> String { "base" }
}
