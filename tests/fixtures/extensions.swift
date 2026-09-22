import fixture

public extension Robot {
    func fly() -> String { "fly \(name)" }

    var wingspan: Int { name.count }
}
