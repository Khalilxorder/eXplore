import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-codex-audit/**",
    ".next-codex-build/**",
    ".next-codex-final/**",
    "out/**",
    "build/**",
    "android/**",
    "tmp/**",
    "next-env.d.ts",
    "recovery_materials/**",
    "artifacts/**",
    "scratch/**",
    "runtime-logs/**",
    "output/**",
    "explore.db",
    "backend/node_modules/**",
  ]),
  {
    files: ["backend/**/*.js", "scripts/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        Promise: "readonly",
        Map: "readonly",
        Set: "readonly",
        Intl: "readonly",
        URL: "readonly",
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    }
  }
]);

export default eslintConfig;
