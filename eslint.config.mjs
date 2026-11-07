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
    // Generated output and Next's auto-written env file are not our source.
    // Without this, `eslint .` reports thousands of errors from .next/ and the
    // lint gate becomes meaningless.
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Hexagonal boundary: the domain must stay free of infrastructure and
    // framework imports so it can be tested offline and reused anywhere.
    // See docs/TACTICAL-DESIGN.md §11.
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@aws-sdk/*", "next/*", "next", "react", "react-dom", "@/infra/*"],
              message:
                "src/domain must not import infrastructure or framework code. Keep it pure (DESIGN.md §1, TACTICAL-DESIGN.md §11).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;

