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
