const db = require('../config/db');
const cronParser = require('cron-parser');
const configProvider = require('./config');

// Hàm wrapper hỗ trợ mọi định dạng export của thư viện cron-parser (CJS/ESM)
function parseCron(expression, options) {
    if (typeof cronParser.parseExpression === 'function') {
        return cronParser.parseExpression(expression, options);
    }
    if (cronParser.default && typeof cronParser.default.parse === 'function') {
        return cronParser.default.parse(expression, options);
    }
    throw new Error('Unsupported cron-parser version');
}

class HealthProvider {
    constructor() {
        this.startTime = new Date();
        this.runningJobs = new Set(); // Theo dõi các job đang chạy trong bộ nhớ
    }

    /**
     * Ghi nhận một Job bắt đầu chạy
     * @param {string} jobName 
     */
    markJobStarted(jobName) {
        this.runningJobs.add(jobName);
    }

    /**
     * Ghi nhận một Job đã chạy xong
     * @param {string} jobName 
     */
    markJobFinished(jobName) {
        this.runningJobs.delete(jobName);
    }

    /**
     * Kiểm tra xem Job có đang chạy không
     * @param {string} jobName 
     * @returns {boolean}
     */
    isJobRunning(jobName) {
        return this.runningJobs.has(jobName);
    }

    /**
     * Đếm số lượng Job đang chạy
     * @returns {number}
     */
    getRunningJobsCount() {
        return this.runningJobs.size;
    }

    /**
     * Tính toán Uptime định dạng chuỗi đọc được (e.g. "1d 5h 30m")
     * @returns {string}
     */
    getUptime() {
        const diffMs = Date.now() - this.startTime.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        const days = Math.floor(diffSecs / 86400);
        const hours = Math.floor((diffSecs % 86400) / 3600);
        const mins = Math.floor((diffSecs % 3600) / 60);

        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        parts.push(`${mins}m`);
        return parts.join(' ');
    }

    /**
     * Tổng hợp các chỉ số hiệu năng (Metrics) từ bảng audit_logs
     * @returns {Promise<Object>}
     */
    async getMetrics() {
        try {
            // Lấy 1000 log scheduler gần nhất để tổng hợp số liệu
            const rows = await db.all(
                "SELECT details FROM audit_logs WHERE action = 'SCHEDULER_JOB' ORDER BY id DESC LIMIT 1000"
            );

            let jobsExecuted = 0;
            let jobsFailed = 0;
            let jobsSkipped = 0;
            let totalExecTime = 0;
            let countForAvg = 0;

            for (const row of rows) {
                try {
                    const details = JSON.parse(row.details);
                    if (details.status === 'success') {
                        jobsExecuted++;
                        totalExecTime += details.executionTime || 0;
                        countForAvg++;
                    } else if (details.status === 'failed') {
                        jobsExecuted++;
                        jobsFailed++;
                        totalExecTime += details.executionTime || 0;
                        countForAvg++;
                    } else if (details.status === 'skipped') {
                        jobsSkipped++;
                    }
                } catch (parseErr) {
                    // Bỏ qua nếu lỗi parse JSON
                }
            }

            const avgExecutionTime = countForAvg > 0 ? Math.floor(totalExecTime / countForAvg) : 0;

            return {
                jobsExecuted,
                jobsFailed,
                jobsSkipped,
                avgExecutionTime
            };
        } catch (err) {
            console.error('[HEALTH PROVIDER] Lỗi khi tổng hợp metrics:', err);
            return {
                jobsExecuted: 0,
                jobsFailed: 0,
                jobsSkipped: 0,
                avgExecutionTime: 0
            };
        }
    }

    /**
     * Đánh giá sức khỏe toàn cục của Scheduler
     * @param {Array<Object>} jobsStatus - Trạng thái của từng job
     * @param {boolean} isSchedulerEnabled - Trạng thái kích hoạt của Scheduler
     * @returns {string} HEALTHY | DEGRADED | UNHEALTHY
     */
    getGlobalStatus(jobsStatus, isSchedulerEnabled) {
        if (!isSchedulerEnabled) return 'UNHEALTHY';
        if (jobsStatus.length === 0) return 'HEALTHY';

        const failedCount = jobsStatus.filter(j => j.lastStatus === 'failed').length;
        if (failedCount === 0) return 'HEALTHY';
        if (failedCount === jobsStatus.length) return 'UNHEALTHY';
        return 'DEGRADED';
    }

    /**
     * Lấy trạng thái vận hành của một Job cụ thể
     * @param {Object} jobDef - Định nghĩa Job
     */
    async getJobStatus(jobDef) {
        const cron = await configProvider.getCronExpression(jobDef.name);
        const enabled = await configProvider.isJobEnabled(jobDef.name);
        const timezone = await configProvider.getTimezone();
        const running = this.isJobRunning(jobDef.name);

        let nextRun = null;
        if (enabled) {
            try {
                const interval = parseCron(cron, { tz: timezone });
                nextRun = interval.next().toISOString();
            } catch (cronErr) {
                console.error(`[HEALTH PROVIDER] Lỗi parse biểu thức cron cho "${jobDef.name}":`, cronErr);
            }
        }

        let lastRun = null;
        let lastStatus = null;
        let executionTime = null;

        try {
            // Truy vấn log chạy gần nhất của Job này trong audit_logs
            const row = await db.get(
                "SELECT details, created_at FROM audit_logs WHERE action = 'SCHEDULER_JOB' AND target = ? ORDER BY id DESC LIMIT 1",
                [`job:${jobDef.name}`]
            );
            if (row) {
                lastRun = row.created_at;
                const details = JSON.parse(row.details);
                lastStatus = details.status;
                executionTime = details.executionTime;
            }
        } catch (dbErr) {
            console.error(`[HEALTH PROVIDER] Lỗi truy vấn log chạy gần nhất cho "${jobDef.name}":`, dbErr);
        }

        return {
            name: jobDef.name,
            enabled,
            running,
            cron,
            timezone,
            nextRun,
            lastRun,
            lastStatus,
            executionTime
        };
    }
}

module.exports = new HealthProvider();
