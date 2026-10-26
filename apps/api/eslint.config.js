import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strict,
  { ignores: ['dist/', 'coverage/', 'src/generated/', 'scripts/'] },
  {
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off', // Nest modules are empty classes
      // Raw SQL only via Prisma tagged templates: $queryRaw`...`, never $queryRawUnsafe.
      'no-restricted-properties': ['error',
        { property: '$queryRawUnsafe', message: 'Use tagged $queryRaw templates (SQL injection risk).' },
        { property: '$executeRawUnsafe', message: 'Use tagged $executeRaw templates (SQL injection risk).' }],
    },
  },
  // Tests index into fixtures they just created; `!` keeps them readable.
  { files: ['test/**/*.ts'], rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },
);
