let cachedMsgSend: NativeFunction<NativePointer, [NativePointerValue, NativePointerValue]> | null = null;
let cachedUTF8StringSelector: NativePointer | null = null;

function getMsgSend(): NativeFunction<NativePointer, [NativePointerValue, NativePointerValue]> {
  if (cachedMsgSend === null) {
    const libobjc = Process.getModuleByName("libobjc.A.dylib");
    cachedMsgSend = new NativeFunction(libobjc.getExportByName("objc_msgSend"), "pointer", [
      "pointer",
      "pointer",
    ]);
  }
  return cachedMsgSend;
}

function getUTF8StringSelector(): NativePointer {
  if (cachedUTF8StringSelector === null) {
    const libobjc = Process.getModuleByName("libobjc.A.dylib");
    const selRegisterName = new NativeFunction(
      libobjc.getExportByName("sel_registerName"),
      "pointer",
      ["pointer"]
    );
    cachedUTF8StringSelector = selRegisterName(Memory.allocUtf8String("UTF8String")) as NativePointer;
  }
  return cachedUTF8StringSelector;
}

export function objcUTF8String(object: NativePointer): string | null {
  return getMsgSend()(object, getUTF8StringSelector()).readUtf8String();
}
