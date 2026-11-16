// PM2 — той самий підхід, що CRM/календар (без Docker).
module.exports = {
  apps: [
    {
      name: 'ads-api',
      script: 'apps/api/src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env_production: { NODE_ENV: 'production' },
    },
  ],
};
