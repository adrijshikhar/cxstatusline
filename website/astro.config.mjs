import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const local = (path) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  output: "static",
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      dedupe: ["react", "react-dom", "react-reconciler", "scheduler"],
      alias: [
        { find: /^ink$/, replacement: local("./node_modules/ink-web/dist/index.js") },
        { find: /^(node:)?fs\/promises$/, replacement: local("./src/fs-promises.ts") },
        { find: /^(node:)?fs$/, replacement: local("./src/fs.ts") },
        { find: /^(node:)?(os|child_process|crypto)$/, replacement: local("./src/node-shims.ts") },
        { find: /^(node:)?path$/, replacement: local("./src/path-shim.ts") },
      ],
    },
    define: {
      "process.env.CXSTATUSLINE_WEB": '"1"',
      "process.env": "{}",
      "process.argv": "[]",
      "process.platform": '"browser"',
      "process.pid": "0",
      "process.stdout": "{}",
      "process.on": "undefined",
      "process.execPath": '""',
    },
    build: { target: "esnext" },
  },
});
