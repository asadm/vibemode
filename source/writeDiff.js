// source/writeDiff.js

import fs from 'fs/promises';
import logger from './logger.js'; // Keep logger for the file I/O part

/**
 * Parses a diff string and applies the changes sequentially to the input content string.
 * Returns the modified content string if all changes apply successfully.
 * If any search pattern is not found, it collects details about each failure
 * and returns a formatted string describing all failures.
 *
 * @param {string} originalContent The initial content to modify.
 * @param {string} changes The diff string containing search/replace blocks.
 * @returns {string} The modified content string if successful, or a formatted error string if any patches failed.
 */
export function applyDiff(originalContent, changes) {
    logger.info(`Applying diff to content (length ${originalContent?.length})...`);

    // --- 1. Parse the diff string into change objects ---
    const changeRegex = /<<<<<<< SEARCH\s*\n(.*?)\s*=======\s*\n(.*?)\s*>>>>>>> REPLACE/gs;
    const parsedChanges = [];
    let match;

    while ((match = changeRegex.exec(changes)) !== null) {
        parsedChanges.push({
            search: match[1],
            replace: match[2],
        });
    }

    if (parsedChanges.length === 0 && changes.trim() !== '') {
         logger.warn(`Warning: The provided changes string did not contain any valid SEARCH/REPLACE blocks.`);
         // If no valid changes, return the original content unmodified
         return originalContent;
    } else if (parsedChanges.length === 0) {
        logger.info(`No changes parsed from the diff string.`);
        // If no changes parsed, return the original content unmodified
        return originalContent;
    } else {
        logger.info(`Parsed ${parsedChanges.length} change blocks.`);
    }

    // --- 2. Apply changes sequentially and collect errors ---
    const errors = [];
    let processedContent = originalContent; // Start with original content
    let changesAppliedCount = 0; // Track successful applications

    for (let i = 0; i < parsedChanges.length; i++) {
        const { search, replace } = parsedChanges[i];
        const index = processedContent.indexOf(search);

        if (index === -1) {
            // Search pattern not found - Record the error
            // Note: No filename context here as this function is pure
            const errorDetail = `Change #${i + 1} failed: Search pattern not found.\n\n--- Search Pattern ---\n${search}\n----------------------`;
            errors.push(errorDetail);
            logger.warn(`Diff Apply Error: Change #${i + 1} failed - Search pattern not found.`);
            // Do NOT apply the change, continue to the next potential change
        } else {
            // Search pattern found - Apply the change
            processedContent = processedContent.replace(search, replace);
            changesAppliedCount++;
            logger.info(`Successfully staged change #${i + 1}.`);
        }
    }

    // --- 3. Return results: Error report or processed content ---
    if (errors.length > 0) {
        // Errors occurred, return the report
        logger.error(`${errors.length} error(s) occurred while applying diff.`);
        const errorReport = `Failed to apply all patches:\n\n` + errors.join('\n\n');
        // Log the full report for clarity
        logger.error("--- Diff Apply Error Report ---");
        logger.error(errorReport);
        logger.error("-----------------------------");
        return errorReport; // Return the formatted error string
    } else {
        // No errors occurred
        if (changesAppliedCount > 0) {
             logger.info(`Successfully applied ${changesAppliedCount} change(s) to the content.`);
        } else if (parsedChanges.length > 0) {
             logger.info(`All ${parsedChanges.length} search patterns were found, but applying them resulted in no change to the content.`);
        }
        // Always return the processed content on success, even if identical
        return processedContent;
    }
}


/**
 * Reads a file, applies diff changes using applyDiff, and writes the result back.
 * Throws errors on file read/write issues or if applyDiff succeeds but content is identical.
 * Returns false if the file was successfully written with changes.
 * Returns an error string from applyDiff if patches failed (and doesn't write).
 *
 * @param {string} filename The path to the file to modify.
 * @param {string} changes The diff string containing search/replace blocks.
 * @returns {Promise<string | false>} A promise resolving to an error string from applyDiff if patches failed,
 *   or `false` if the file was successfully modified and written.
 * @throws {Error} If the file cannot be read, written, or if content is unchanged after patching.
 */
export async function writeDiffToFile(filename, changes) {
    logger.info(`Attempting to apply changes and write to ${filename}...`);

    // --- 1. Read the original file content ---
    let originalContent;
    try {
        originalContent = await fs.readFile(filename, 'utf8');
        logger.info(`Successfully read ${filename}.`);
    } catch (error) {
        logger.error(`Error reading file ${filename}:`, error);
        throw new Error(`Failed to read file ${filename}: ${error.message}`);
    }

    // --- 2. Apply the diff logic ---
    const result = applyDiff(originalContent, changes);

    // --- 3. Handle results ---
    if (typeof result === 'string' && result !== originalContent && result.startsWith('Failed to apply all patches:')) {
        // applyDiff returned an error report string
        logger.error(`Patch application failed for ${filename}. File will NOT be modified.`);
        // Add filename context to the error report before returning
        return `Patch application failed for "${filename}":\n${result}`;
    } else if (typeof result === 'string') {
        // applyDiff succeeded, 'result' is the processed content string
        const processedContent = result;

        if (processedContent === originalContent) {
             logger.warn(`Applying changes resulted in no difference to the content of ${filename}. File not modified.`);
             // Throw error consistent with original function's behavior
             throw new Error(`Successfully applied change(s) but the final content is identical to the original for ${filename}.`);
        }

        // Content has changed, proceed to write
        try {
            await fs.writeFile(filename, processedContent, 'utf8');
            const changesAppliedCount = (processedContent.split('\n').length !== originalContent.split('\n').length) || (processedContent !== originalContent) ? 'some' : 'no'; // Simple check, could be improved
            logger.info(`Successfully applied ${changesAppliedCount} change(s) and wrote modifications back to ${filename}.`);
            return false; // Indicate success (file written)
        } catch (error) {
            logger.error(`Error writing file ${filename} after successful patching:`, error);
            throw new Error(`Successfully patched content but failed to write changes to ${filename}: ${error.message}`);
        }
    } else {
         // Should not happen if applyDiff always returns a string, but handle defensively
         logger.error(`Unexpected result type from applyDiff: ${typeof result}`);
         throw new Error(`Internal error: Unexpected result type from applyDiff.`);
    }
}