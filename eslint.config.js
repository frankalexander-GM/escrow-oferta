const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "artifacts/**",
      "cache/**",
      "coverage/**",
      "typechain-types/**",
      "servidor/abi/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
      "no-var": "error",
      "no-throw-literal": "error",
      "no-else-return": "error",
      "no-implicit-coercion": "error",
      curly: ["error", "multi-line"],
      "no-console": "off",
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: { globals: { ...globals.mocha } },
  },
];
