import { demangle } from "./demangle.js";
import { findType } from "../reflection/registry.js";
import { getMetadata, Metadata } from "../abi/metadata.js";
import { buildGenericMetadata } from "../abi/generic-instantiation.js";

export interface SwiftSymbol {
  address: NativePointer;
  name: string;
  demangled: string;
}

export interface SwiftFunctionSignature {
  kind: "function";
  context: string;
  name: string;
  genericParams: string[];
  // false for same-type / pack / shape signatures: metadata count != genericParams.length
  simpleGenerics: boolean;
  throws: boolean;
  argTypeNames: string[];
  argLabels: (string | null)[]; // null = unlabelled
  returnTypeName: string | null;
  selector: string; // e.g. "greet(name:to:)"
}

export interface SwiftAccessorSignature {
  kind: "getter" | "setter" | "modify";
  context: string;
  member: string;
  typeName: string;
}

export type ParsedSwiftSignature = SwiftFunctionSignature | SwiftAccessorSignature;

export interface ResolvedFunctionSignature {
  throws: boolean;
  argTypes: Metadata[];
  returnType: Metadata | null;
}

const exportsByModule = new Map<string, Map<string, string>>();

export function symbolicate(address: NativePointer): SwiftSymbol | null {
  const module = Process.findModuleByAddress(address);
  if (module === null) {
    return null;
  }

  let names = exportsByModule.get(module.path);
  if (names === undefined) {
    names = new Map<string, string>();
    for (const e of module.enumerateExports()) {
      if (e.type === "function") {
        names.set(e.address.toString(), e.name);
      }
    }
    exportsByModule.set(module.path, names);
  }

  const name = names.get(address.toString());
  if (name === undefined) {
    return null;
  }
  const demangled = demangle(name);
  if (demangled === null) {
    return null;
  }
  return { address, name, demangled };
}

export function parseSwiftSignature(demangled: string): ParsedSwiftSignature | null {
  const accessor = parseAccessor(demangled);
  if (accessor !== null) {
    return accessor;
  }
  return parseFunction(demangled);
}

function parseAccessor(s: string): SwiftAccessorSignature | null {
  for (const kind of ["getter", "setter", "modify"] as const) {
    const marker = `.${kind} : `;
    const at = s.indexOf(marker);
    if (at === -1) {
      continue;
    }
    const path = s.slice(0, at);
    const typeName = s.slice(at + marker.length).trim();
    const dot = lastTopLevelDot(path);
    if (dot === -1) {
      return null;
    }
    return { kind, context: path.slice(0, dot), member: path.slice(dot + 1), typeName };
  }
  return null;
}

function parseFunction(s: string): SwiftFunctionSignature | null {
  const open = topLevelIndexOf(s, "(");
  if (open === -1) {
    return null;
  }
  const close = matchingBracket(s, open);
  if (close === -1) {
    return null;
  }

  const path = s.slice(0, open);
  const dot = lastTopLevelDot(path);
  if (dot === -1) {
    return null;
  }

  const inner = s.slice(open + 1, close);
  const parsedArgs = splitTopLevel(inner, ",").map(argLabelAndType);
  const argTypeNames = parsedArgs.map((a) => a.type);
  const argLabels = parsedArgs.map((a) => a.label);

  const tail = s.slice(close + 1);
  const arrow = tail.indexOf("->");
  if (arrow === -1) {
    return null;
  }
  const returnTypeName = tail.slice(arrow + 2).trim();

  const { name, genericParams, simpleGenerics } = splitGenericClause(path.slice(dot + 1));
  const selector = `${name}(${argLabels.map((l) => `${l ?? "_"}:`).join("")})`;

  return {
    kind: "function",
    context: path.slice(0, dot),
    name,
    genericParams,
    simpleGenerics,
    throws: /\bthrows\b/.test(tail.slice(0, arrow)),
    argTypeNames,
    argLabels,
    returnTypeName: returnTypeName === "()" ? null : returnTypeName,
    selector,
  };
}

function splitGenericClause(name: string): {
  name: string;
  genericParams: string[];
  simpleGenerics: boolean;
} {
  const lt = topLevelIndexOf(name, "<");
  if (lt === -1 || !name.endsWith(">")) {
    return { name, genericParams: [], simpleGenerics: true };
  }
  const inner = name.slice(lt + 1, name.length - 1);
  const segments = splitTopLevel(inner, " where ");
  const params = splitTopLevel(segments[0], ",");
  const whereClause = segments.length > 1 ? segments[1] : "";
  const simpleGenerics = params.every((p) => /^[A-Za-z_]\w*$/.test(p)) && !/==/.test(whereClause);
  return {
    name: name.slice(0, lt),
    genericParams: params.map((p) => p.split(/\s+/)[0]),
    simpleGenerics,
  };
}

function argLabelAndType(item: string): { label: string | null; type: string } {
  const colon = topLevelIndexOf(item, ": ");
  if (colon === -1) {
    return { label: null, type: item.trim() };
  }
  const label = item.slice(0, colon).trim();
  return { label: label === "_" ? null : label, type: item.slice(colon + 2).trim() };
}

export function resolveFunctionSignature(
  signature: SwiftFunctionSignature
): ResolvedFunctionSignature | null {
  const argTypes: Metadata[] = [];
  for (const name of signature.argTypeNames) {
    const metadata = resolveType(name);
    if (metadata === null) {
      return null;
    }
    argTypes.push(metadata);
  }

  let returnType: Metadata | null = null;
  if (signature.returnTypeName !== null) {
    returnType = resolveType(signature.returnTypeName);
    if (returnType === null) {
      return null;
    }
  }

  return { throws: signature.throws, argTypes, returnType };
}

export function resolveType(name: string): Metadata | null {
  const descriptor = findType(name);
  if (descriptor === null) {
    return null;
  }
  try {
    return getMetadata(descriptor);
  } catch {
    return null;
  }
}

function instantiate(base: string, args: (Metadata | null)[]): Metadata | null {
  const descriptor = findType(base);
  if (descriptor === null || args.some((a) => a === null)) {
    return null;
  }
  try {
    return buildGenericMetadata(descriptor, args as Metadata[]);
  } catch {
    return null;
  }
}

// Desugars A? / [A] / [K: V] / Base<...>, resolving each leaf via resolveParam (generics) or findType.
export function resolveTypeExpr(
  expr: string,
  resolveParam: (name: string) => Metadata | null
): Metadata | null {
  expr = expr.trim();
  if (expr.endsWith("?") || expr.endsWith("!")) {
    return instantiate("Swift.Optional", [resolveTypeExpr(expr.slice(0, -1), resolveParam)]);
  }
  if (expr.startsWith("[") && matchingBracket(expr, 0) === expr.length - 1) {
    const inner = expr.slice(1, -1);
    const colon = topLevelIndexOf(inner, ":");
    if (colon !== -1) {
      return instantiate("Swift.Dictionary", [
        resolveTypeExpr(inner.slice(0, colon), resolveParam),
        resolveTypeExpr(inner.slice(colon + 1), resolveParam),
      ]);
    }
    return instantiate("Swift.Array", [resolveTypeExpr(inner, resolveParam)]);
  }
  const lt = topLevelIndexOf(expr, "<");
  if (lt !== -1 && expr.endsWith(">")) {
    const args = splitTopLevel(expr.slice(lt + 1, -1), ",").map((a) =>
      resolveTypeExpr(a, resolveParam)
    );
    return instantiate(expr.slice(0, lt), args);
  }
  return resolveParam(expr) ?? resolveType(expr);
}

const OPEN: Record<string, string> = { "(": ")", "<": ">", "[": "]" };
const CLOSE = new Set([")", ">", "]"]);

function depthDelta(ch: string): number {
  if (ch in OPEN) return 1;
  if (CLOSE.has(ch)) return -1;
  return 0;
}

function topLevelIndexOf(s: string, needle: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (depth === 0 && s.startsWith(needle, i)) {
      return i;
    }
    depth += depthDelta(s[i]);
  }
  return -1;
}

function lastTopLevelDot(s: string): number {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    if (depth === 0 && s[i] === ".") {
      last = i;
    }
    depth += depthDelta(s[i]);
  }
  return last;
}

function matchingBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    depth += depthDelta(s[i]);
    if (depth === 0) {
      return i;
    }
  }
  return -1;
}

function splitTopLevel(s: string, sep: string): string[] {
  if (s.trim() === "") {
    return [];
  }
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (depth === 0 && s.startsWith(sep, i)) {
      parts.push(s.slice(start, i));
      i += sep.length - 1;
      start = i + 1;
      continue;
    }
    depth += depthDelta(s[i]);
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim());
}
