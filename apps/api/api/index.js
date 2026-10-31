// Vercel function. All routes (/v1/*) are rewritten to /api (vercel.json); the compiled Nest app lives in dist/.
export { default } from '../dist/serverless.js';
