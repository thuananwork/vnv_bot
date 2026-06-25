const app = require('./app');
const { initDb } = require('./config/db');

const PORT = process.env.PORT || 3000;

async function start() {
    try {
        console.log('Đang khởi tạo cơ sở dữ liệu SQLite...');
        await initDb();
        
        app.listen(PORT, () => {
            console.log('----------------------------------------------------');
            console.log('VNV-BOT V2 - LOCAL BACKEND SERVER STARTED');
            console.log(`Ứng dụng đang chạy tại: http://localhost:${PORT}`);
            console.log('Đăng nhập quản trị mặc định:');
            console.log(' - Username: admin');
            console.log(' - Password: admin');
            console.log('----------------------------------------------------');
        });
    } catch (err) {
        console.error('Không thể khởi động ứng dụng:', err);
        process.exit(1);
    }
}

start();
