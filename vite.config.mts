import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const externals = [
  "@fiftyone/components",
  "@fiftyone/operators",
  "@fiftyone/state",
  "@fiftyone/utilities",
  "@fiftyone/spaces",
  "@fiftyone/plugins",
  "@fiftyone/aggregations",
  "react",
  "react-dom",
  "recoil",
  "@mui/material",
  "@mui/icons-material",
  "styled-components",
];

const globals = {
  react: "React",
  "react-dom": "ReactDOM",
  recoil: "recoil",
  "@fiftyone/state": "__fos__",
  "@fiftyone/plugins": "__fop__",
  "@fiftyone/operators": "__foo__",
  "@fiftyone/components": "__foc__",
  "@fiftyone/utilities": "__fou__",
  "@fiftyone/spaces": "__fosp__",
  "@fiftyone/aggregations": "__foa__",
  "@mui/material": "__mui__",
  "@mui/icons-material": "__mui_icons__",
  "styled-components": "__styled__",
};

export default defineConfig({
  mode: "production",
  plugins: [cssInjectedByJsPlugin()],
  resolve: {
    alias: {
      // VOODO is precompiled with the automatic JSX runtime; the FiftyOne
      // App only exposes the classic ``React`` global. The shim delegates
      // jsx/jsxs to React.createElement so we don't bundle React twice.
      "react/jsx-runtime": resolve(__dirname, "src/jsx-runtime-shim.ts"),
    },
  },
  esbuild: {
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
  },
  build: {
    minify: true,
    lib: {
      entry: resolve(__dirname, "src/index.tsx"),
      name: "@Burhan-Q/fo-duckdb",
      fileName: (format) => `index.${format}.js`,
      formats: ["umd"],
    },
    rollupOptions: {
      external: externals,
      output: { globals },
    },
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  optimizeDeps: {
    exclude: ["react", "react-dom"],
  },
  worker: {
    format: "es",
  },
});
