import { getSwiftCoreApi } from "./runtime/api.js";
import { demangle } from "./runtime/demangle.js";

export { isSwiftSymbol, demangle } from "./runtime/demangle.js";
export {
  RelativeDirectPointer,
  RelativeIndirectablePointer,
} from "./basic/relative-pointer.js";
export {
  getSwiftSection,
  enumerateTypeContextDescriptors,
  readTypeContextName,
} from "./macho/sections.js";

export const Swift = {
  get available(): boolean {
    try {
      getSwiftCoreApi();
      return true;
    } catch {
      return false;
    }
  },

  demangle,
};
