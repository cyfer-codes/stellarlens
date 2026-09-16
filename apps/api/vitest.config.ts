import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts", "test/**/*.e2e-spec.ts"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false
  },
  plugins: [swc.vite()]
});
