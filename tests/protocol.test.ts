import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import {
  Swift,
  Metadata,
  MetadataKind,
  ClassType,
  Protocol,
  ProtocolComposition,
  readString,
  readValue,
} from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";

function fixtureFn(swiftName: string): NativePointer {
  const mod = loadFixture();
  for (const e of mod.enumerateExports()) {
    const demangled = Swift.demangle(e.name);
    if (demangled !== null && demangled.includes(swiftName)) {
      return e.address;
    }
  }
  throw new Error(`fixture export not found: ${swiftName}`);
}

function existentialMetadata(accessor: string): Metadata {
  const RawPointer = Swift.metadataFor("Swift.UnsafeRawPointer")!;
  const get = makeSwiftNativeFunction(fixtureFn(accessor), RawPointer, []);
  return new Metadata(get()!.readPointer());
}

describe("Protocol", () => {
  test("resolves a value-witness protocol and reports its shape", () => {
    loadFixture();
    const greeter = Protocol.find("fixture.Greeter")!;
    expect(greeter).not.toBeNull();
    expect(greeter.name).toBe("Greeter");
    expect(greeter.moduleName).toBe("fixture");
    expect(greeter.fullName).toBe("fixture.Greeter");
    expect(greeter.numRequirements).toBeGreaterThan(0);
    expect(greeter.isClassOnly).toBe(false);
  });

  test("reports an AnyObject protocol as class-only", () => {
    loadFixture();
    expect(Protocol.find("fixture.Named")!.isClassOnly).toBe(true);
  });

  test("returns null for an unknown protocol", () => {
    loadFixture();
    expect(Protocol.find("fixture.NoSuchProtocolQX")).toBeNull();
  });

  test("conformanceFor yields a witness table for a conformer and null otherwise", () => {
    loadFixture();
    const scalable = Protocol.find("fixture.Scalable")!;
    const Int = Swift.metadataFor("Swift.Int")!;
    const Bool = Swift.metadataFor("Swift.Bool")!;
    expect(scalable.conformanceFor(Int)!.isNull()).toBe(false);
    expect(scalable.conformanceFor(Bool)).toBeNull();
  });

  test("Swift.Protocol exposes the class on the facade", () => {
    loadFixture();
    expect(Swift.Protocol.find("fixture.Greeter")).not.toBeNull();
  });
});

describe("protocols()", () => {
  test("a type reports its declared conformances as a name->Protocol map", () => {
    loadFixture();
    const person = Swift.typeOf(Swift.metadataFor("fixture.Person")!);
    const protocols = person.protocols();
    expect(Object.keys(protocols).sort()).toEqual(["fixture.Aged", "fixture.Greeter"]);
    expect(protocols["fixture.Greeter"] instanceof Protocol).toBe(true);
    expect(protocols["fixture.Greeter"].fullName).toBe("fixture.Greeter");
  });

  test("includes a retroactive conformance declared in another module", () => {
    loadFixture();
    const int = Swift.typeOf(Swift.metadataFor("Swift.Int")!);
    expect(Object.keys(int.protocols())).toContain("fixture.Scalable");
  });

  test("is reachable through the object facade's $type", () => {
    loadFixture();
    const widget = (Swift.typeOf(Swift.metadataFor("fixture.Widget")!) as ClassType).init("w");
    expect(Object.keys(widget.$type.protocols())).toContain("fixture.Named");
  });
});

describe("ProtocolComposition", () => {
  test("single-protocol metadata equals the compiler's existential metadata", () => {
    const greeter = ProtocolComposition.fromSignature("fixture.Greeter");
    expect(greeter.numProtocols).toBe(1);
    expect(greeter.isClassOnly).toBe(false);
    expect(greeter.metadata.kind).toBe(MetadataKind.Existential);
    expect(greeter.metadata.handle.equals(existentialMetadata("fixture.greeterType"))).toBe(
      true
    );
  });

  test("multi-protocol composition matches `any Greeter & Aged`", () => {
    const ga = ProtocolComposition.fromSignature("fixture.Greeter & fixture.Aged");
    expect(ga.numProtocols).toBe(2);
    expect(ga.isClassOnly).toBe(false);
    expect(ga.metadata.handle.equals(existentialMetadata("fixture.greeterAgedType"))).toBe(
      true
    );
  });

  test("a class-only member makes the whole composition class-only", () => {
    const named = ProtocolComposition.fromSignature("fixture.Named");
    expect(named.isClassOnly).toBe(true);
    expect(named.metadata.handle.equals(existentialMetadata("fixture.namedType"))).toBe(true);
  });

  test("rejects an unknown protocol in the signature", () => {
    loadFixture();
    expect(() => ProtocolComposition.fromSignature("fixture.NoSuchProtocolQX")).toThrow();
  });
});

describe("Swift.NativeFunction with protocol types", () => {
  test("a ProtocolComposition drives an existential return then argument", () => {
    const String_ = Swift.metadataFor("Swift.String")!;
    const Greeter = ProtocolComposition.fromSignature("fixture.Greeter");
    const make = Swift.NativeFunction(fixtureFn("fixture.makeGreeterExistential"), Greeter, []);
    const g = make()!;
    expect(readValue(Greeter.metadata, g)).toEqual({ name: "Ada" });
    const greet = Swift.NativeFunction(fixtureFn("fixture.greetExistential"), String_, [Greeter]);
    expect(readString(greet(g)!)).toBe("Hello, Ada");
  });

  test("a bare Protocol is lowered to its single-protocol existential", () => {
    const String_ = Swift.metadataFor("Swift.String")!;
    const greeter = Protocol.find("fixture.Greeter")!;
    const make = Swift.NativeFunction(fixtureFn("fixture.makeGreeterExistential"), greeter, []);
    const greet = Swift.NativeFunction(fixtureFn("fixture.greetExistential"), String_, [greeter]);
    expect(readString(greet(make()!)!)).toBe("Hello, Ada");
  });

  test("a composition existential round-trips through describeGreeterAged", () => {
    const String_ = Swift.metadataFor("Swift.String")!;
    const ga = ProtocolComposition.fromSignature("fixture.Greeter & fixture.Aged");
    const make = Swift.NativeFunction(fixtureFn("fixture.makeGreeterAged"), ga, []);
    const describe = Swift.NativeFunction(fixtureFn("fixture.describeGreeterAged"), String_, [ga]);
    expect(readString(describe(make()!)!)).toBe("Hi, Cy (9)");
  });
});
