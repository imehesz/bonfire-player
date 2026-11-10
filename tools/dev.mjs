// `npm run dev`: the API and the Vite dev server together. Ctrl+C stops both.
import { spawn } from 'node:child_process';
const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit' });
const kids = [run('node', ['server/server.mjs']), run('npx', ['vite', '--host'])];
const stop = () => { for (const k of kids) k.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const k of kids) k.on('exit', stop);
