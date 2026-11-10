// pm2 config for the API. Copy to ecosystem.config.js (gitignored) and adjust.
// Start with: pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [{ name: 'bonfire-tracks-api', script: 'server/server.mjs', cwd: __dirname, env: { NODE_ENV: 'production' } }],
};
