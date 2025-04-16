import fs from 'fs/promises';
// import path from 'path'; // Optional, but good practice for handling paths
import logger from './logger.js';

/**
 * Parses a diff string and attempts to apply the changes sequentially to a file.
 * If all changes apply successfully, overwrites the original file and returns false.
 * If any search pattern is not found, it collects details about each failure,
 * does NOT modify the file, and returns a string describing all failures.
 *
 * @param {string} filename The path to the file to modify.
 * @param {string} changes The diff string containing search/replace blocks.
 * @returns {Promise<string | false>} A promise that resolves to a formatted error string
 *   if any patches failed, or `false` if all patches were applied successfully and the file was written.
 * @throws {Error} If the file cannot be read or (if successful) written.
 */
export async function writeDiff(filename, changes) {
    logger.info(`Attempting to apply changes to ${filename}...`);

    // --- 1. Read the original file content ---
    let currentContent;
    try {
        currentContent = await fs.readFile(filename, 'utf8');
        logger.info(`Successfully read ${filename}.`);
    } catch (error) {
        // Reading the file is a prerequisite, throw if it fails
        logger.error(`Error reading file ${filename}:`, error);
        throw new Error(`Failed to read file ${filename}: ${error.message}`);
    }

    // --- 2. Parse the diff string into change objects ---
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
    } else if (parsedChanges.length > 0) {
         logger.info(`Parsed ${parsedChanges.length} change blocks.`);
    }

    // --- 3. Apply changes sequentially and collect errors ---
    const errors = [];
    let processedContent = currentContent; // Start with original content
    let changesAppliedCount = 0; // Track successful applications

    for (let i = 0; i < parsedChanges.length; i++) {
        const { search, replace } = parsedChanges[i];
        // Operate on the *current* state of processedContent for this iteration
        const index = processedContent.indexOf(search);

        if (index === -1) {
            // Search pattern not found - Record the error
            const errorDetail = `Change #${i + 1} failed for file "${filename}":\n  Search pattern not found.\n\n--- Search Pattern ---\n${search}\n----------------------`;
            errors.push(errorDetail);
            logger.warn(`Patch Error: Change #${i + 1} failed - Search pattern not found.`);
            // Do NOT apply the change, continue to the next potential change
        } else {
            // Search pattern found - Apply the change
            // Replace the *first* occurrence in the current processed content
            processedContent = processedContent.replace(search, replace);
            changesAppliedCount++;
            logger.info(`Successfully staged change #${i + 1}.`);
        }
    }

    // --- 4. Handle results: Write file or return errors ---
    if (errors.length > 0) {
        // Errors occurred, do not write the file
        logger.error(`\n${errors.length} error(s) occurred while processing changes for ${filename}. File was NOT modified.`);
        const errorReport = `Failed to apply all patches to "${filename}":\n\n` + errors.join('\n\n');
        // Log the full report for clarity
        logger.error("--- Error Report ---");
        logger.error(errorReport);
        logger.error("--------------------");
        return errorReport; // Return the formatted error string
    } else {
        // No errors occurred
        if (changesAppliedCount === 0 && parsedChanges.length > 0) {
             logger.info(`All ${parsedChanges.length} search patterns were found, but applying them resulted in no change to the content. File ${filename} not modified.`);
             return false;
        } else if (changesAppliedCount === 0 && parsedChanges.length === 0) {
            logger.info(`No changes parsed or applied. File ${filename} not modified.`);
            throw new Error(`No changes parsed or applied.`);
        } else if (processedContent === currentContent) {
             // This case might happen if search === replace for all changes
            logger.info(`Applied ${changesAppliedCount} change(s), but the final content is identical to the original. File ${filename} not modified.`);
            // return false;
            throw new Error(`Successfully applied ${changesAppliedCount} change(s) but the final content is identical to the original.`);
        }

        // No errors and content has changed, proceed to write
        try {
            await fs.writeFile(filename, processedContent, 'utf8');
            logger.info(`Successfully applied ${changesAppliedCount} change(s) and wrote modifications back to ${filename}.`);
            return false; // Indicate success
        } catch (error) {
            // Writing the file failed, this is a file system error, throw it
            logger.error(`Error writing file ${filename} after successful patching:`, error);
            throw new Error(`Successfully patched content but failed to write changes to ${filename}: ${error.message}`);
        }
    }
}

// --- Example Usage (add this outside the function if needed for testing) ---

/*
// Example of calling and handling the result:
async function runExample() {
    const testFilename = 'example_for_errors.js';
    const initialContent = `
    line one
    // SEARCH BLOCK 1 START
    find me once
    // SEARCH BLOCK 1 END
    line four
    // SEARCH BLOCK 2 START
    find me twice
    // SEARCH BLOCK 2 END
    line seven
    `;
    const diffWithErrors = `
<<<<<<< SEARCH
// SEARCH BLOCK 1 START
find me once
// SEARCH BLOCK 1 END
=======
// REPLACED BLOCK 1 START
you found me once
// REPLACED BLOCK 1 END
>>>>>>> REPLACE

<<<<<<< SEARCH
// NON-EXISTENT BLOCK
this text is not in the file
// END NON-EXISTENT BLOCK
=======
// WONT BE APPLIED
this should not appear
// END WONT BE APPLIED
>>>>>>> REPLACE

<<<<<<< SEARCH
// SEARCH BLOCK 2 START
find me twice
// SEARCH BLOCK 2 END
=======
// REPLACED BLOCK 2 START
you found me twice
// REPLACED BLOCK 2 END
>>>>>>> REPLACE
    `;

    try {
        await fs.writeFile(testFilename, initialContent, 'utf8');
        logger.info(`Created ${testFilename}`);

        const result = await writeDiff(testFilename, diffWithErrors);

        if (result === false) {
            logger.info("\nSUCCESS: All patches applied successfully.");
            // You can optionally read the file here to verify
            const finalContent = await fs.readFile(testFilename, 'utf8');
             logger.info(`\n--- Final Content of ${testFilename} ---`);
             logger.info(finalContent);
             logger.info("-----------------------------------");
        } else {
            logger.error("\nFAILURE: Some patches could not be applied.");
            logger.error("Returned error report:\n" + result);
            // Verify file was NOT changed
             const finalContent = await fs.readFile(testFilename, 'utf8');
            if (finalContent === initialContent) {
                logger.info(`\nVerified: ${testFilename} content remains unchanged from the original.`);
            } else {
                 logger.error(`\nERROR: ${testFilename} content WAS MODIFIED despite patch errors!`);
            }
        }

    } catch (error) {
        logger.error("\n--- An unexpected error occurred ---");
        logger.error(error);
    } finally {
        // Clean up
        try { await fs.unlink(testFilename); logger.info(`\nCleaned up ${testFilename}`); } catch {}
    }
}

runExample();
*/