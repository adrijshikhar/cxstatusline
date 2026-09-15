import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const local = (path) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  output: "static",
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
        { find: /^(node:)?path$/, replacement: local("./node_modules/path-browserify/index.js") },
      ],
    },
    define: {
      "process.env.CXSTATUSLINE_WEB": '"1"',
      "process.env": "{}",
      "process.argv": "[]",
      "process.platform": '"browser"',
    },
    build: { target: "esnext" },
  },
});
