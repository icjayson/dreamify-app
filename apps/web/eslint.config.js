import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".next",
      "node_modules",
      "app/.well-known/workflow",
      "src/main.tsx",
      // The imported Lightswind gallery is retained as migration source, but is
      // not in the application graph. Keep the one runtime primitive linted;
      // check-lint-boundary.mjs prevents an ignored primitive becoming active.
      "src/ui/lightswind/**/*",
      "!src/ui/lightswind/wave-background.tsx",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
    },
  },
  {
    // Ambient browser declarations require `var` so they merge onto Window.
    files: ["src/**/*.d.ts"],
    rules: {
      "no-var": "off",
    },
  },
);
