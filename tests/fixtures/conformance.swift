import fixture

public protocol Flyable {
    func soar() -> String
}

extension Robot: Flyable {
    public func soar() -> String { "soar \(name)" }
}
