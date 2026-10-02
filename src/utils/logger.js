const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const asyncLocalStorage = new AsyncLocalStorage();

const LEVELS = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
    fatal: 5
};

const configuredLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const configuredWeight = LEVELS[configuredLevel] !== undefined ? LEVELS[configuredLevel] : 2;

const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

let currentLogDate = '';

function cleanOldLogs(keepDays = 14) {
    try {
        const files = fs.readdirSync(logDir);
        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() - keepDays);
        
        for (const file of files) {
            const match = file.match(/^app-(\d{4}-\d{2}-\d{2})\.log$/);
            if (match) {
                const fileDate = new Date(match[1]);
                if (fileDate < thresholdDate) {
                    fs.unlinkSync(path.join(logDir, file));
                }
            }
        }
    } catch (err) {
        // Silence log rotator clean error
    }
}

function writeLog(level, message, metadata = {}) {
    const levelWeight = LEVELS[level.toLowerCase()];
    if (levelWeight < configuredWeight) {
        return;
    }

    const store = asyncLocalStorage.getStore();
    const requestId = metadata.requestId || (store ? store.requestId : undefined);
    const parentRequestId = metadata.parentRequestId || (store ? store.parentRequestId : undefined);

    const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message: typeof message === 'string' ? message : JSON.stringify(message),
        ...metadata
    };

    if (requestId) logEntry.request_id = requestId;
    if (parentRequestId) logEntry.parent_request_id = parentRequestId;

    // Filter out standard fields from metadata to avoid duplication
    delete logEntry.requestId;
    delete logEntry.parentRequestId;

    const logString = JSON.stringify(logEntry);

    // Print to console
    const isSimpleConsole = process.env.CONSOLE_FORMAT === 'simple' || process.env.NODE_ENV !== 'production';
    if (isSimpleConsole) {
        const timeStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const simpleMeta = { ...metadata };
        delete simpleMeta.event;
        delete simpleMeta.config_hash;
        delete simpleMeta.safe_mode;
        delete simpleMeta.log_level;
        delete simpleMeta.google_enabled;
        delete simpleMeta.queue_limit;
        
        let metaStr = '';
        if (Object.keys(simpleMeta).length > 0) {
            metaStr = ` ${JSON.stringify(simpleMeta)}`;
        }
        const consoleMsg = `[${timeStr}] [${level.toUpperCase()}] ${message}${metaStr}`;
        
        if (levelWeight >= LEVELS.error) {
            console.error(consoleMsg);
        } else {
            console.log(consoleMsg);
        }
    } else {
        if (levelWeight >= LEVELS.error) {
            console.error(logString);
        } else {
            console.log(logString);
        }
    }

    // Write to daily rotated log file synchronously using appendFileSync
    try {
        const todayStr = new Date().toLocaleDateString('sv'); // YYYY-MM-DD
        if (todayStr !== currentLogDate) {
            currentLogDate = todayStr;
            cleanOldLogs(14);
        }
        const logPath = path.join(logDir, `app-${todayStr}.log`);
        fs.appendFileSync(logPath, logString + '\n', 'utf8');
    } catch (err) {
        console.error('[LOGGER ERROR] Ghi file log thất bại:', err.message);
    }
}

const logger = {
    asyncLocalStorage,
    trace: (msg, meta) => writeLog('trace', msg, meta),
    debug: (msg, meta) => writeLog('debug', msg, meta),
    info: (msg, meta) => writeLog('info', msg, meta),
    warn: (msg, meta) => writeLog('warn', msg, meta),
    error: (msg, meta) => writeLog('error', msg, meta),
    fatal: (msg, meta) => writeLog('fatal', msg, meta)
};

module.exports = logger;
