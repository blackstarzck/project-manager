import path from 'node:path';
import { createApp } from './app.js';
import { defaultDataDirectory, ensureDataDirectory, loadEnvironment } from './config.js';

loadEnvironment();
const port=Number(process.env.PORT || 3100);
const app=await createApp({dbPath:ensureDataDirectory(defaultDataDirectory()),staticDirectory:path.join(process.cwd(),'dist'),allowedOrigins:[`http://127.0.0.1:${port}`,`http://localhost:${port}`,'http://127.0.0.1:5173','http://localhost:5173']});
await app.listen({host:'127.0.0.1',port});
console.log(`Planit local server: http://127.0.0.1:${port}`);
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
