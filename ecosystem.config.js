// PM2 Ecosystem Configuration - VNV Bot V2 Production
// Sử dụng: pm2 start ecosystem.config.js --env production

module.exports = {
    apps: [
        {
            name: 'vnv-bot-v2',
            script: 'src/index.js',
            instances: 1, // Single instance vì SQLite không hỗ trợ concurrent writes
            exec_mode: 'fork',
            max_memory_restart: '512M',
            node_args: '--env-file=config/.env',

            // Environment variables cho Production
            env_production: {
                NODE_ENV: 'production',
                PORT: 3000,
                LOG_LEVEL: 'info',
                SAFE_MODE: 'false'
            },

            // Environment variables cho Staging
            env_staging: {
                NODE_ENV: 'staging',
                PORT: 3001,
                LOG_LEVEL: 'debug',
                SAFE_MODE: 'true'
            },

            // Auto-restart policy
            autorestart: true,
            restart_delay: 5000,        // Chờ 5s trước khi restart
            max_restarts: 10,           // Tối đa 10 lần restart liên tiếp
            min_uptime: '10s',          // Phải chạy tối thiểu 10s mới tính là stable

            // Log configuration
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            error_file: 'logs/pm2-error.log',
            out_file: 'logs/pm2-out.log',
            merge_logs: true,
            log_type: 'json',

            // Graceful shutdown
            kill_timeout: 15000,        // 15s timeout khớp với shutdown_timeout_ms
            listen_timeout: 10000,
            shutdown_with_message: true,

            // Health check (PM2 Plus feature)
            // Nếu dùng PM2 Plus, bật health check endpoint
            // health_check: {
            //     url: 'http://localhost:3000/api/health',
            //     interval: 30000
            // }
        }
    ],

    // Deployment configuration cho PM2 deploy
    deploy: {
        production: {
            user: 'deploy',
            host: ['vps-01'],
            ref: 'origin/main',
            repo: 'git@github.com:thuananwork/vnv_bot.git',
            path: '/home/deploy/vnv-bot-v2',
            'pre-deploy-local': '',
            'post-deploy': 'npm install --production && pm2 reload ecosystem.config.js --env production',
            'pre-setup': ''
        }
    }
};
