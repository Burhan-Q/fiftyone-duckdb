import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/js/**/*.test.ts"],
    environment: "node",
    alias: {
      "plotly.js-cartesian-dist-min": path.resolve(
        __dirname,
        "tests/js/__mocks__/plotly.js-cartesian-dist-min.ts",
      ),
      "react-plotly.js/factory": path.resolve(
        __dirname,
        "tests/js/__mocks__/react-plotly.js-factory.ts",
      ),
      "react/jsx-dev-runtime": path.resolve(
        __dirname,
        "tests/js/__mocks__/react-jsx-dev-runtime.ts",
      ),
    },
  },
});
