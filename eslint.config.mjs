import tseslint from "typescript-eslint";
import globals from "globals";

const SHARED_RULES = {
  "no-console": ["warn", { allow: ["error", "warn", "log"] }],
  "no-var": "error",
  "prefer-const": "error",
  eqeqeq: ["error", "smart"],
  "no-unused-vars": "off",
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
  ],
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
  "@typescript-eslint/no-non-null-assertion": "off",
};

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", ".agents/skills/**", ".claude/skills/**"] },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      ...SHARED_RULES,
      "max-lines": ["error", { max: 200, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["src/ui/**/*.tsx"],
    rules: { "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: { "max-lines": "off" },
  },
);
