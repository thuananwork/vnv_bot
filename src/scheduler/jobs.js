const distribute = require('./distribute.job');
const summarize = require('./summarize.job');
const syncSheets = require('./syncSheets.job');
const sendReports = require('./sendReports.job');
const backupDb = require('./backupDb.job');

module.exports = [
    distribute,
    summarize,
    syncSheets,
    sendReports,
    backupDb
];
