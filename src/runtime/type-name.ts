import { Metadata } from "../abi/metadata.js";
import { getSwiftCoreApi } from "./api.js";

export function typeName(metadata: Metadata, qualified = true): string {
  const [data, length] = getSwiftCoreApi().swift_getTypeName(
    metadata.handle,
    qualified ? 1 : 0
  );
  return data.readUtf8String(Number(length)) ?? "";
}
