import 'dotenv/config';
import { loadEnv } from './config/env.js';
import { createApp } from './bootstrap.js';

const env = loadEnv();
const app = await createApp(env);
app.enableShutdownHooks();
await app.listen(env.API_PORT);
