// logger.js
import fs from 'fs';
import path from 'path';
import util from 'util';


// Define the log file path - always in the current working directory
const logFilePath = path.join(process.cwd(), 'log.log');

// Create a writable stream in append mode ('a')
// clear the file first
fs.writeFileSync(logFilePath, '');

// This keeps the file open for efficiency and appends new logs
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

// Handle potential errors on the stream (e.g., file permissions, disk full)
logStream.on('error', (err) => {
    // Log stream errors to the console as we can't write to the file
    console.error('Log stream error:', err);
});

/**
 * Writes a formatted log entry to the stream.
 * @param {string} level - The log level (e.g., 'INFO', 'WARN', 'ERROR').
 * @param {...any} args - The message parts to log (will be formatted).
 */
function writeLog(level, ...args) {
    try {
        const timestamp = new Date().toISOString();
        // Use util.format to handle different argument types gracefully (like console.log)
        const message = util.format(...args);
        const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

        // Write the entry to the stream
        logStream.write(logEntry);
    } catch (error) {
        // Catch any unexpected errors during formatting or writing
        console.error('Failed to write log entry:', error);
        // Attempt to log the original message and level to stderr as a fallback
        console.error(`Fallback Log [${level.toUpperCase()}]:`, ...args);
    }
}

// The logger object (singleton instance)
const logger = {
    info: (...args) => {
        writeLog('info', ...args);
    },
    warn: (...args) => {
        writeLog('warn', ...args);
        // Optional: Also log warnings to the console for immediate visibility
        // console.warn(`[WARN] ${util.format(...args)}`);
    },
    error: (...args) => {
        writeLog('error', ...args);
        // It's usually good practice to also log errors to stderr
        // console.error(`[ERROR] ${util.format(...args)}`);
    },
    // Optional: A function to explicitly close the stream if needed,
    // though Node often handles this on exit. Useful for graceful shutdowns.
    // close: () => {
    //     logStream.end(() => {
    //         console.log('Log stream closed.');
    //     });
    // }
};

export default logger;