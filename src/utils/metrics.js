const db = require('../config/db');

// In-memory metrics counters
const state = {
    pipeline_processed_total: 0,
    token_refresh_total: 0,
    google_sync_success_total: 0,
    google_sync_failed_total: 0,
    worker_restart_total: 0
};

/**
 * Increment a metric counter
 * @param {string} name 
 */
function increment(name) {
    if (state[name] !== undefined) {
        state[name]++;
    }
}

/**
 * Get current Zalo queue depth dynamically from database
 * @returns {Promise<number>}
 */
async function getQueueDepth() {
    try {
        const row = await db.get("SELECT COUNT(*) as count FROM zalo_message_queue WHERE status = 'pending'");
        return row ? row.count : 0;
    } catch (err) {
        return 0;
    }
}

/**
 * Format and return metrics in Prometheus exposition format
 * @returns {Promise<string>}
 */
async function formatPrometheusMetrics() {
    const queueDepth = await getQueueDepth();
    let gitCommit = process.env.GIT_COMMIT;
    if (!gitCommit) {
        try {
            gitCommit = require('child_process').execSync('git rev-parse --short HEAD', { stdio: 'pipe' }).toString().trim();
        } catch (e) {
            gitCommit = '131c2e5';
        }
    }
    const buildDate = process.env.BUILD_DATE || '2026-07-02';
    const version = process.env.APP_VERSION || '2.0.0';

    let output = '';

    output += '# HELP build_info Static build information\n';
    output += '# TYPE build_info gauge\n';
    output += `build_info{version="${version}",git_commit="${gitCommit}",build_date="${buildDate}"} 1\n\n`;

    output += '# HELP pipeline_processed_total Total messages processed by pipeline\n';
    output += '# TYPE pipeline_processed_total counter\n';
    output += `pipeline_processed_total ${state.pipeline_processed_total}\n\n`;

    output += '# HELP queue_depth Current depth of message queue\n';
    output += '# TYPE queue_depth gauge\n';
    output += `queue_depth ${queueDepth}\n\n`;

    output += '# HELP token_refresh_total Total token rotations performed\n';
    output += '# TYPE token_refresh_total counter\n';
    output += `token_refresh_total ${state.token_refresh_total}\n\n`;

    output += '# HELP google_sync_success_total Total successful Google Sheets synchronization runs\n';
    output += '# TYPE google_sync_success_total counter\n';
    output += `google_sync_success_total ${state.google_sync_success_total}\n\n`;

    output += '# HELP google_sync_failed_total Total failed Google Sheets synchronization runs\n';
    output += '# TYPE google_sync_failed_total counter\n';
    output += `google_sync_failed_total ${state.google_sync_failed_total}\n\n`;

    output += '# HELP worker_restart_total Total Puppeteer worker restarts\n';
    output += '# TYPE worker_restart_total counter\n';
    output += `worker_restart_total ${state.worker_restart_total}\n`;

    return output;
}

module.exports = {
    state,
    increment,
    formatPrometheusMetrics
};
