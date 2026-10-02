const db = require('../config/db');

class TaskService {
    /**
     * Lấy nhiệm vụ theo ngày xuất bản (publishDate: YYYY-MM-DD)
     * @param {string} publishDate 
     * @returns {Promise<Object|null>}
     */
    async getTaskByDate(publishDate) {
        try {
            return await db.get('SELECT * FROM tasks WHERE publish_date = ?', [publishDate]);
        } catch (err) {
            console.error(`[TASK SERVICE] Lỗi khi lấy nhiệm vụ cho ngày ${publishDate}:`, err);
            throw err;
        }
    }

    /**
     * Lấy nhiệm vụ theo mã code
     * @param {string} taskCode 
     * @returns {Promise<Object|null>}
     */
    async getTaskByCode(taskCode) {
        try {
            return await db.get('SELECT * FROM tasks WHERE task_code = ?', [taskCode]);
        } catch (err) {
            console.error(`[TASK SERVICE] Lỗi khi lấy nhiệm vụ theo mã ${taskCode}:`, err);
            throw err;
        }
    }

    /**
     * Lấy nhiệm vụ được tạo mới nhất
     * @returns {Promise<Object|null>}
     */
    async getLatestTask() {
        try {
            return await db.get('SELECT * FROM tasks ORDER BY publish_date DESC LIMIT 1');
        } catch (err) {
            console.error('[TASK SERVICE] Lỗi khi lấy nhiệm vụ mới nhất:', err);
            throw err;
        }
    }
}

module.exports = new TaskService();
