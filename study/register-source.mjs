import { registerHooks } from "node:module";

// 直接运行下载的 TypeScript 源码，不依赖构建产物或 npm 上的另一个版本。
const sourceEntries = new Map([
  ["@earendil-works/pi-ai", new URL("../pi/packages/ai/src/index.ts", import.meta.url).href],
  ["@earendil-works/pi-telemetry", new URL("../pi/packages/telemetry/src/index.ts", import.meta.url).href],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = sourceEntries.get(specifier);
    return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
  },
});
