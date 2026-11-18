import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [".next/**", "convex/_generated/**", "archive/**", "node_modules/**"],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    // D-019: import Effect modules by path ("effect/Effect"), never the
    // "effect" barrel; esbuild (Convex, Next) tree-shakes the barrel poorly
    // (~4x larger bundles).
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "effect",
              message: "Import Effect modules by path, e.g. `import * as Effect from 'effect/Effect'` (D-019).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
