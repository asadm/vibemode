// source/writeDiff.js

import fs from 'fs/promises';
import logger from './logger.js';


/* ─────────────────────────── Helper utils ─────────────────────────── */

function getCommonIndent(lines) {
    let min = null;
    for (const l of lines) {
      if (l.trim() === '') continue;
      const ind = l.match(/^\s*/)[0];
      if (min === null || ind.length < min.length) min = ind;
      if (min.length === 0) break;
    }
    return min ?? '';
  }
  
  function reindent(lines, baseIndent) {
    if (!baseIndent) return lines;
  
    const common = getCommonIndent(lines);
  
    return lines.map(line => {
      if (line.trim() === '') return line;                       // keep blank lines untouched
      const relative = line.startsWith(common)
        ? line.slice(common.length)                              // preserve **relative** indent
        : line.trimStart();
      return baseIndent + relative;
    });
  }
  
  function stripBlankEdges(arr) {
    let s = 0, e = arr.length - 1;
    while (s <= e && arr[s].trim() === '') s += 1;
    while (e >= s && arr[e].trim() === '') e -= 1;
    return arr.slice(s, e + 1);
  }
  
  const arraysEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  
  /* ───────────────────── core search/replace routine ───────────────────── */
  
  function findAndReplaceLinesIgnoringWhitespace(content, search, replace) {
    /* ---------- 0. SEARCH is **only blank lines** ---------- */
    const searchIsBlank = search.every(l => l.trim() === '');
    if (searchIsBlank) {
      // ① look for an equal‑length run of blank lines in the file
      for (let i = 0; i <= content.length - search.length; i++) {
        if (content.slice(i, i + search.length).every(l => l.trim() === '')) {
          const indent = (content[i] ?? '').match(/^\s*/)[0] ?? '';
          const newLines = reindent(replace, indent);
          return {
            found: true,
            matchLineIndex: i,
            modifiedLines: [
              ...content.slice(0, i),
              ...newLines,
              ...content.slice(i + search.length),
            ],
          };
        }
      }
      // ② no blank stretch found → just insert at top of file
      const newLines = reindent(replace, '');
      return {
        found: true,
        matchLineIndex: 0,
        modifiedLines: [...newLines, ...content],
      };
    }

    /* ---------- 1. single‑line SEARCH ---------- */
    if (search.length === 1) {
      const term = search[0].trim();
      if (term === '') return { found: false };
  
      for (let i = 0; i < content.length; i++) {
        const line = content[i];
  
        /* full‑line equality */
        if (line.trim() === term) {
          const indent = line.match(/^\s*/)[0];
          const newLines = reindent(replace, indent);
          return {
            found: true,
            matchLineIndex: i,
            modifiedLines: [
              ...content.slice(0, i),
              ...newLines,
              ...content.slice(i + 1),
            ],
          };
        }
  
        /* substring match – only if REPLACE is single‑line too */
        if (line.includes(term) && replace.length === 1) {
          const newLine = line.replace(term, replace[0]);
          const modified = [...content];
          modified[i] = newLine;
          return { found: true, matchLineIndex: i, modifiedLines: modified };
        }
      }
      return { found: false };
    }
  
    /* ---------- 2. multi‑line SEARCH ---------- */
  
    // attempt the *old* strict‑indent matcher first (keeps previous passing cases)
    const strict = strictMultiLineMatch(content, search, replace);
    if (strict.found) return strict;
  
    // …fallback: totally ignore leading whitespace/blank‑edge lines
    const coreSearch = stripBlankEdges(search);
    if (coreSearch.length === 0) return { found: false };
  
    const normSearch = coreSearch.map(l => l.trimStart());
  
    for (let i = 0; i <= content.length - coreSearch.length; i++) {
      const slice = content.slice(i, i + coreSearch.length);
      const normSlice = slice.map(l => l.trimStart());
  
      if (arraysEqual(normSlice, normSearch)) {
        const indent = slice[0].match(/^\s*/)[0];
        const newLines = reindent(replace, indent);
        return {
          found: true,
          matchLineIndex: i,
          modifiedLines: [
            ...content.slice(0, i),
            ...newLines,
            ...content.slice(i + coreSearch.length),
          ],
        };
      }
    }
  
    return { found: false };
  }
  
  /* ── previous strict algorithm kept as helper to preserve behaviour ── */
  function strictMultiLineMatch(contentLines, searchLines, replaceLines) {
    const searchIndent = getCommonIndent(searchLines);
    const strippedSearch = searchLines.map(l =>
      l.startsWith(searchIndent) ? l.slice(searchIndent.length) : l,
    );
    const searchBlock = strippedSearch.filter(l => l.trim() !== '').join('\n');
  
    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      const candidate = contentLines.slice(i, i + searchLines.length);
      const candIndent = getCommonIndent(candidate);
      const strippedCand = candidate.map(l =>
        l.startsWith(candIndent) ? l.slice(candIndent.length) : l,
      );
      const candBlock = strippedCand.filter(l => l.trim() !== '').join('\n');
  
      if (candBlock === searchBlock) {
        const indent = candidate[0].match(/^\s*/)[0];
        const newLines = reindent(replaceLines, indent);
        return {
          found: true,
          matchLineIndex: i,
          modifiedLines: [
            ...contentLines.slice(0, i),
            ...newLines,
            ...contentLines.slice(i + searchLines.length),
          ],
        };
      }
    }
    return { found: false };
  }
  

// --- Main applyDiff Function ---
/**
 * Parses a diff string and applies the changes sequentially to the input content string,
 * attempting to ignore common leading whitespace differences.
 * Returns the modified content string if all changes apply successfully.
 * If any search pattern is not found, it collects details about the first failure
 * and returns a formatted string describing it. Processing stops on first failure.
 *
 * @param {string} originalContent The initial content to modify.
 * @param {string} changes The diff string containing search/replace blocks.
 * @returns {string} The modified content string if successful, or a formatted error string if any patches failed.
 */
export function applyDiff(originalContent, changes) {
    logger.info(`Applying diff to content (length ${originalContent?.length}), ignoring common whitespace...`);
    const changeRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/gs;
    const parsedChanges = [];
    let match;
    while ((match = changeRegex.exec(changes)) !== null) {
        // Use blocks as captured directly from regex
        const searchBlock = match[1];
        const replaceBlock = match[2];
        parsedChanges.push({ search: searchBlock, replace: replaceBlock });
    }

    if (parsedChanges.length === 0) {
        if (changes.trim() !== '' && !/<<<<<<< SEARCH\n[\s\S]*?\n=======\n[\s\S]*?\n>>>>>>> REPLACE/s.test(changes)) {
           logger.warn(`Warning: The provided changes string did not contain any valid SEARCH/REPLACE blocks.`);
        } else if (changes.trim() === '') {
            logger.info(`No changes parsed from the empty diff string.`);
        }
        return originalContent; // Return original if no changes parsed or found
    } else {
        logger.info(`Parsed ${parsedChanges.length} change blocks.`);
    }

    const errors = [];
    // Handle potential trailing newline carefully for reconstruction
    const originalEndsWithNewline = originalContent.endsWith('\n');
    // Start with splitting. If the original ends with \n, split adds an extra empty string.
    let currentContentLines = originalContent.split('\n');
    if (originalEndsWithNewline && currentContentLines.length > 0 && currentContentLines[currentContentLines.length - 1] === '') {
        currentContentLines.pop(); // Remove trailing empty string for processing
    }
    logger.info(`Initial content lines for processing: ${currentContentLines.length}`);

    let changesAppliedCount = 0;
    let appliedSuccessfully = true;

    for (let i = 0; i < parsedChanges.length; i++) {
        const { search, replace } = parsedChanges[i];

        // Split lines here before passing to helper
        const searchLines = search.split('\n');
        const replaceLines = replace.split('\n');

        logger.info(`Attempting change #${i + 1}. Current total lines: ${currentContentLines.length}`);

        const result = findAndReplaceLinesIgnoringWhitespace(currentContentLines, searchLines, replaceLines);

        if (!result.found) {
            const errorDetail = `Change #${i + 1} failed: Search pattern not found (even ignoring whitespace).\n\n--- Search Pattern ---\n${search}\n----------------------`; // Use original search block for error reporting
            errors.push(errorDetail);
            logger.warn(`Diff Apply Error: Change #${i + 1} failed - Search pattern not found.`);
            appliedSuccessfully = false;
            break; // Stop on first failure
        } else {
            currentContentLines = result.modifiedLines;
            changesAppliedCount++;
            logger.info(`Successfully staged change #${i + 1}. New total lines: ${currentContentLines.length}`);
        }
    }

    if (!appliedSuccessfully) {
        logger.error(`${errors.length} error(s) occurred while applying diff. Processing stopped.`);
        const errorReport = `Failed to apply all patches:\n\n` + errors.join('\n\n'); // Should only have one error
        logger.error("--- Diff Apply Error Report ---");
        logger.error(errorReport);
        logger.error("-----------------------------");
        return errorReport;
    } else {
        // Reconstruct final string
        let processedContent = currentContentLines.join('\n');
        // Add back trailing newline IF original had one
        if (originalEndsWithNewline) {
             // Ensure it's added only once, crucial for empty content case
            if (!processedContent.endsWith('\n')) {
                processedContent += '\n';
            }
        }

        logger.info(`Final reconstructed content length: ${processedContent.length}`);

        if (changesAppliedCount > 0) {
             logger.info(`Successfully applied ${changesAppliedCount} change(s) to the content.`);
        } else if (parsedChanges.length > 0) {
             logger.info(`All ${parsedChanges.length} search patterns were found, but applying them resulted in no effective change to the content (or Search/Replace were identical).`);
        }
        return processedContent;
    }
}

// --- writeDiffToFile Function ---
/**
 * Reads a file, applies diff changes using applyDiff, and writes the result back.
 * Throws errors on file read/write issues or if applyDiff succeeds but content is identical
 * after attempting valid change blocks.
 * Returns false if the file was successfully written with changes or if no write was needed.
 * Returns an error string from applyDiff if patches failed (and doesn't write).
 *
 * @param {string} filename The path to the file to modify.
 * @param {string} changes The diff string containing search/replace blocks.
 * @returns {Promise<string | false>} A promise resolving to an error string from applyDiff if patches failed,
 *   or `false` if the file was successfully modified and written OR if no changes were needed/applied.
 * @throws {Error} If the file cannot be read, written, or if content is unchanged after attempting valid patches.
 */
export async function writeDiffToFile(filename, changes) {
    logger.info(`Attempting to apply changes and write to ${filename}...`);
     let originalContent;
     try {
         originalContent = await fs.readFile(filename, 'utf8');
         logger.info(`Successfully read ${filename}.`);
     } catch (error) {
         logger.error(`Error reading file ${filename}:`, error);
         throw new Error(`Failed to read file ${filename}: ${error.message}`);
     }

     const result = applyDiff(originalContent, changes);

     if (typeof result === 'string' && result.startsWith('Failed to apply all patches:')) {
         logger.error(`Patch application failed for ${filename}. File will NOT be modified.`);
         return `Patch application failed for "${filename}":\n${result}`;
     } else if (typeof result === 'string') {
         const processedContent = result;
         if (processedContent === originalContent) {
             const changeRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/gs;
             const hadValidBlocks = changeRegex.test(changes);
             if (hadValidBlocks) {
                 logger.warn(`Applying changes resulted in no difference to the content of ${filename}. File not modified.`);
                  throw new Error(`Successfully applied change(s) but the final content is identical to the original for ${filename}.`);
             } else {
                 logger.info(`No valid change blocks found or applied to ${filename}. File not written.`);
                 return false; // Indicate success: no failure, but no write occurred.
             }
         }
         try {
             await fs.writeFile(filename, processedContent, 'utf8');
             logger.info(`Successfully applied changes and wrote modifications back to ${filename}.`);
             return false; // Indicate success: file written.
         } catch (error) {
             logger.error(`Error writing file ${filename} after successful patching:`, error);
             throw new Error(`Successfully patched content but failed to write changes to ${filename}: ${error.message}`);
         }
     } else {
          logger.error(`Internal error: Unexpected result type from applyDiff: ${typeof result}`);
          throw new Error(`Internal error: Unexpected result type from applyDiff.`);
     }
}