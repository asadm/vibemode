// source/components/PackFilesUI.js
import React, { useState, useEffect, useMemo } from 'react'; // Added useMemo
import { Box, Text } from 'ink';
import { glob } from 'glob'; // Still need async glob
import fsSync from 'fs'; // Keep sync fs for specific checks if needed (like in processQuery)
import fs from 'fs/promises'; // Import promises API for async readdir
import path from 'path';
import clipboardy from 'clipboardy';
import ignore from 'ignore'; // <-- Import the ignore package
import Fuse from 'fuse.js'; // <-- Import Fuse.js
import logger from '../logger.js';
import AutoComplete from '../autocomplete.js';

import { encoding_for_model } from "@dqbd/tiktoken";

let encoder = null;

const getEncoder = () => {
    if (!encoder) {
        encoder = encoding_for_model('gpt-4o');
    }
    return encoder;
};

const escapeXml = (unsafe) => {
    if (typeof unsafe !== 'string') {
        try { return String(unsafe); } catch (e) { logger.warn(`Warning: Could not convert value to string for XML escaping: ${unsafe}`); return ''; }
    }
    const map = {'<': '<', '>': '>', '&': '&', "'": '\'', '"': '"'};
    return unsafe.replace(/[<>&'"]/g, c => map[c] || c);
};


const PackFilesUI = ({
    collectedFiles,
    setCollectedFiles,
    setMode,
    setStatusMessage,
    ignorePatterns,
    onEscape,
}) => {
    const [globQuery, setGlobQuery] = useState('');
    // Initial status indicates loading but allows typing
    const [localStatus, setLocalStatus] = useState('Scanning directories for autocomplete... You can start typing patterns now.');
    const [availablePaths, setAvailablePaths] = useState([]);
    const [loadingPaths, setLoadingPaths] = useState(true);
    const [fuseInstance, setFuseInstance] = useState(null); // <-- State for Fuse instance

    // --- Parallel Directory Scan Effect ---
    useEffect(() => {
        const fetchPathsParallel = async () => {
            setLoadingPaths(true);
            setLocalStatus('Scanning top-level items for autocomplete...');
            logger.info('Starting parallel directory scan for autocomplete...');
            const startTime = Date.now();

            try {
                const cwd = process.cwd();
                const ig = ignore().add(ignorePatterns); // Initialize ignore filter

                // 1. Read top-level entries
                let topLevelEntries;
                try {
                    topLevelEntries = await fs.readdir(cwd, { withFileTypes: true });
                    logger.info(`Read ${topLevelEntries.length} top-level entries.`);
                } catch (readDirError) {
                    logger.error(`Error reading top-level directory ${cwd}:`, readDirError);
                    throw new Error(`Failed to read top-level directory: ${readDirError.message}`);
                }

                // 2. Filter top-level entries and separate files/dirs
                const topLevelFiles = [];
                const dirsToScan = [];
                for (const entry of topLevelEntries) {
                    // Check if the entry itself is ignored
                    if (!ig.ignores(entry.name)) {
                        if (entry.isDirectory()) {
                            dirsToScan.push(entry);
                        } else if (entry.isFile()) {
                            // Add file directly (normalize slashes)
                            topLevelFiles.push(entry.name.replace(/\\/g, '/'));
                        }
                        // Ignore symlinks, block devices, etc. for simplicity here
                    } else {
                         logger.info(`Ignoring top-level entry: ${entry.name}`);
                    }
                }
                logger.info(`Found ${dirsToScan.length} non-ignored top-level directories to scan and ${topLevelFiles.length} non-ignored top-level files.`);
                setLocalStatus(`Scanning ${dirsToScan.length} top-level directories in parallel...`);


                // 3. Create glob promises for directories
                const globOptions = {
                    cwd: cwd,
                    ignore: ignorePatterns, // Pass ignores for nested filtering
                    mark: true,
                    dot: true,
                    absolute: false,
                };

                const globPromises = dirsToScan.map(dir => {
                    const dirPattern = path.join(dir.name, '**').replace(/\\/g, '/'); // Scan recursively
                    logger.info(`Queueing scan for: ${dirPattern}`);
                    return glob(dirPattern, globOptions)
                        .then(results => {
                             logger.info(`Scan completed for ${dir.name}, found ${results.length} items.`);
                             // --- FIX: Use glob results directly, just normalize slashes ---
                             // Glob results with 'cwd' are already relative to cwd and include the directory prefix.
                             return results.map(p => p.replace(/\\/g, '/'));
                         })
                        .catch(err => {
                            logger.warn(`Failed parallel scan for directory ${dir.name}: ${err.message}`);
                            return [];
                        });
                 });


                // 4. Execute scans in parallel and combine results
                const resultsArrays = await Promise.all(globPromises);
                logger.info('Parallel scans finished. Combining results...');
                setLocalStatus('Combining results...');

                // Flatten the array of arrays from glob results
                const nestedPaths = resultsArrays.flat();

                // Combine top-level files and nested paths, ensure uniqueness and sort
                const allPathsSet = new Set([...topLevelFiles, ...nestedPaths]);
                const finalItems = Array.from(allPathsSet)
                                        .sort()
                                        .map(p => ({ label: p })); // Format for AutoComplete

                const duration = (Date.now() - startTime) / 1000;
                setAvailablePaths(finalItems); // Set the state with all found paths
                const statusMsg = `Loaded ${finalItems.length} potential paths (${duration.toFixed(2)}s). Enter pattern/path, select suggestion, or Enter on empty to finish.`;
                setLocalStatus(statusMsg);
                logger.info(`Parallel scan finished. ${statusMsg}`);

            } catch (error) {
                logger.error('Error during parallel scan for autocomplete:', error);
                setLocalStatus(`Error loading file list: ${error.message}. Autocomplete may be incomplete.`);
                setAvailablePaths([]); // Clear paths on error
            } finally {
                setLoadingPaths(false); // Autocomplete is now ready (or failed)
            }
        };

        fetchPathsParallel();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ignorePatterns]); // Rerun if ignorePatterns change


    // --- Effect to Initialize/Update Fuse.js Instance ---
    useEffect(() => {
        if (!loadingPaths && availablePaths.length > 0) {
            logger.info(`Initializing Fuse.js with ${availablePaths.length} items.`);
            const fuseOptions = {
                // isCaseSensitive: false,
                // includeScore: false,
                shouldSort: true, // Sort by score
                 // findAllMatches: false,
                 // minMatchCharLength: 1,
                // minMatchCharLength: 1,
                threshold: 0.4, // Adjust for desired fuzziness (0=exact, 1=match anything)
                // distance: 100,
                includeMatches: true, // <-- Add this to get match indices
                // includeScore: true, // Optional: for debugging relevance

                // location: 0,
                // useExtendedSearch: false,
                // ignoreLocation: false,
                // ignoreFieldNorm: false,
                // fieldNormWeight: 1,
                keys: [ // The key within our items objects to search
                    "label"
                ]
                };
                setFuseInstance(new Fuse(availablePaths, fuseOptions));
                logger.info("Fuse.js instance created with includeMatches.");
            } else {
                // Clear fuse instance if paths are loading or empty
            setFuseInstance(null);
            logger.info("Fuse.js instance cleared (loading or no paths).");
        }
    }, [availablePaths, loadingPaths]); // Re-run when paths load or change


    // --- Core Handler (processQuery) --- remains largely the same ---
    // Uses async glob internally for resolving user patterns
    const processQuery = async (query) => {
        const trimmedQuery = query.trim();
        logger.info(`Processing query: '${trimmedQuery}'`);
        setLocalStatus('Processing...'); // Indicate processing

        if (trimmedQuery === '' && collectedFiles.size > 0) {
            // --- Generate XML & Copy --- (remains synchronous I/O)
            setMode('processing');
            setStatusMessage('Generating XML and preparing to copy...');
            setTimeout(() => { // Keep timeout for UI update responsiveness
                try {
                    // ... (XML generation logic - unchanged, uses fsSync for checks) ...
                     const filesArray = Array.from(collectedFiles).sort();
                    let dirStructure = '<directory_structure>\n';
                    filesArray.forEach(file => { dirStructure += `  ${escapeXml(file)}\n`; });
                    dirStructure += '</directory_structure>\n\n';

                    let fileContents = '<files>\n<!-- This section contains the contents of the collected files. -->\n\n';
                    filesArray.forEach(file => {
                        const filePath = path.resolve(process.cwd(), file);
                        try {
                            // Use synchronous checks here as it's part of the final synchronous pack logic
                            if (!fsSync.existsSync(filePath) || !fsSync.statSync(filePath).isFile()) {
                                logger.warn(`Skipping non-file or non-existent entry during XML generation: ${file}`);
                                fileContents += `<!-- Skipped non-file/non-existent: ${escapeXml(file)} -->\n\n`;
                                return;
                            }
                            const content = fsSync.readFileSync(filePath, 'utf8');
                            fileContents += `<file path='${escapeXml(file)}'>\n${escapeXml(content)}\n</file>\n\n`;
                        } catch (readError) {
                            fileContents += `<file path='${escapeXml(file)}' error='Could not read file: ${escapeXml(readError.message)}'>\n</file>\n\n`;
                            logger.error(`Error reading ${file}: ${readError.message}`);
                        }
                    });
                    fileContents += '</files>';
                    const finalXmlContent = dirStructure + fileContents;
                    const tokenCount = getEncoder().encode(finalXmlContent).length;
                    logger.info(`Generated XML content for ${filesArray.length} files, token count: ${tokenCount}`);
                    clipboardy.write(finalXmlContent).then(() => {
                        setStatusMessage(`XML for ${collectedFiles.size} files copied to clipboard! Token count: ~${tokenCount}.`);
                         setMode('menu');
                    }).catch(copyError => {
                        logger.error('Error copying XML to clipboard:', copyError);
                         setStatusMessage(`Generated XML, but failed to copy: ${copyError.message}. See logger.`);
                         setMode('menu');
                    });

                } catch (error) {
                    logger.error('Error generating XML content:', error);
                    setStatusMessage(`Error generating XML: ${error.message}. See logger.`);
                    setMode('menu');
                }
            }, 50);

        } else if (trimmedQuery !== '') {
            // --- Process glob or directory (uses async glob) ---
            let globPatternToUse = trimmedQuery.replace(/\\/g, '/');
            let isDirectoryExpansion = false;
            let isActualDirectory = false;

            try {
                 // Sync check is okay here to determine pattern before async glob
                 const stats = fsSync.existsSync(globPatternToUse) ? fsSync.statSync(globPatternToUse) : null;
                 isActualDirectory = stats?.isDirectory() ?? false;
            } catch (statError) {
                 logger.warn(`Could not stat path '${globPatternToUse}': ${statError.message}`);
            }

            // --- Expand directory pattern if necessary ---
            if (isActualDirectory && !globPatternToUse.endsWith('/') && !globPatternToUse.includes('*')) {
                globPatternToUse = path.join(globPatternToUse, '**').replace(/\\/g, '/');
                isDirectoryExpansion = true;
                logger.info(`Input '${trimmedQuery}' is a directory. Using glob pattern: ${globPatternToUse}`);
            } else if (globPatternToUse.endsWith('/')) {
                 globPatternToUse = path.join(globPatternToUse, '**').replace(/\\/g, '/');
                 isDirectoryExpansion = true;
                 logger.info(`Input '${trimmedQuery}' ends with '/'. Using glob pattern: ${globPatternToUse}`);
            }
            // --- Use async glob to find matching files ---
            try {
                const globOptions = {
                    nodir: true, // Only collect files
                    cwd: process.cwd(),
                    ignore: ignorePatterns,
                    dot: true,
                    absolute: false
                };
                // Use the ASYNC glob here
                const foundFiles = await glob(globPatternToUse, globOptions);
                const normalizedFoundFiles = foundFiles.map(p => p.replace(/\\/g, '/'));

                const currentFileCount = collectedFiles.size;
                const updatedFiles = new Set([...collectedFiles, ...normalizedFoundFiles]);
                const newFilesAdded = updatedFiles.size - currentFileCount;
                setCollectedFiles(updatedFiles); // Update parent state

                let message = `Found ${normalizedFoundFiles.length} file(s) matching '${globPatternToUse}'${isDirectoryExpansion ? ` (expanded from '${trimmedQuery}')` : ''}. Added ${newFilesAdded} new file(s). Total: ${updatedFiles.size}.`;
                // Update status message based on whether autocomplete is ready
                 if (loadingPaths) {
                     message += ' (Autocomplete still loading) Enter next pattern/path, or leave empty and press Enter to finish.';
                 } else {
                     message += ' Enter next pattern/path, select suggestion, or leave empty and press Enter to finish.';
                 }
                setLocalStatus(message);

            } catch (error) {
                 const errorMsg = `Error processing glob '${globPatternToUse}'${isDirectoryExpansion ? ` (expanded from '${trimmedQuery}')` : ''}: ${error.message}. Please try again.`;
                setLocalStatus(errorMsg);
                logger.error(`Error processing glob '${globPatternToUse}' (original input: '${trimmedQuery}'):`, error);
            }
            setGlobQuery(''); // Clear input field

        } else {
            // --- Empty query, no files collected yet ---
             let message = 'No files collected yet. Please enter a glob pattern or directory name to find files';
             if (loadingPaths) {
                 message += ' (Autocomplete still loading).';
             } else {
                 message += ', or select a suggestion.';
             }
            setLocalStatus(message);
             setGlobQuery('');
        }
    };

    // --- Handlers for AutoComplete ---
    const handleTextSubmit = (textValue) => {
        logger.info(`Text submitted directly (no suggestions or loading): ${textValue}`);
        processQuery(textValue);
    };
    const handleSuggestionSelect = (item) => {
         // item received here will have { label, value, matches }, but we only process the label
          logger.info(`Suggestion selected: ${item.label}`);
          processQuery(item.label); // Process the selected label
     };

    // --- Calculate Filtered Items for AutoComplete ---
    // This is where the fuzzy search actually happens based on the current input `globQuery`
    const filteredItems = useMemo(() => {
        if (!globQuery || globQuery.trim() === '' || !fuseInstance) {
            // If no input or fuse not ready, return empty array (no suggestions)
            // Alternatively, return `availablePaths` if you want to show all on empty input
            return [];
        }
        logger.info(`Filtering with Fuse for: '${globQuery}'`);
            const results = fuseInstance.search(globQuery);
            // Map results to include match indices
            const mappedItems = results.map(result => {
                // Fuse returns matches like [{ indices: [[start, end], ...], key: 'label', value: '...' }]
                // Consolidate all indices for the 'label' key
                let consolidatedIndices = [];
                if (result.matches) {
                    result.matches.forEach(match => {
                        if (match.key === 'label' && match.indices) {
                            consolidatedIndices = consolidatedIndices.concat(match.indices);
                        }
                    });
                }
                // Sort indices for correct rendering
                consolidatedIndices.sort((a, b) => a[0] - b[0]);

                return {
                    label: result.item.label, // Original label
                    value: result.item.label, // Value for selection
                    matches: consolidatedIndices, // Pass the [start, end] pairs
                };
            });
            // Update logger message if desired
            logger.info(`Mapped ${mappedItems.length} items with match indices.`);
            return mappedItems; // Return items with label, value, and matches
        }, [globQuery, fuseInstance]); // Recalculate when input or fuse instance changes


    // --- Display Collected Files --- (Unchanged)
    const displayFiles = Array.from(collectedFiles).sort();
    const maxFilesToShow = 10;
    const truncated = displayFiles.length > maxFilesToShow;
    const filesString = displayFiles.slice(0, maxFilesToShow).join('\n  ') + (truncated ? `\n  ... (${collectedFiles.size - maxFilesToShow} more)` : '');
    const fileListContent = collectedFiles.size > 0
        ? <Text dimColor>{`  ${filesString}`}</Text>
        : <Text dimColor>(No files collected yet)</Text>;


    // --- Render Logic ---
    return (
        <Box flexDirection='column' padding={1} borderStyle='round' borderColor='blue' minWidth={60}>
            {/* Header */}
            <Box paddingX={1} marginBottom={1}>
                <Text color='blue' bold>--- Pack Files: Add Files ---</Text>
            </Box>
            {/* Status */}
            {localStatus && (
                <Box paddingX={1} marginBottom={1} minHeight={2}>
                    <Text wrap='wrap' color='yellow'>{localStatus}</Text>
                </Box>
            )}

            {/* Collected Files Display */}
            <Box flexDirection='column' marginBottom={1} paddingX={1}>
                <Text>Collected Files ({collectedFiles.size}):</Text>
                 <Box marginLeft={1} minHeight={2} maxHeight={maxFilesToShow + 2} overflowY='hidden'>
                     {fileListContent}
                 </Box>
            </Box>

            {/* AutoComplete Component */}
            <Box borderStyle='round' padding={1} marginX={1} marginBottom={1} flexDirection='column'>
                <Text>Glob Pattern / Path (Fuzzy Search):</Text>
                 {/* Input field is always available */}
                 <AutoComplete
                    value={globQuery}
                    onChange={setGlobQuery}
                    onSubmit={handleTextSubmit}         // Called when Enter pressed in text input *without* suggestions
                    onSuggestionSelect={handleSuggestionSelect}
                    // Pass the PRE-FILTERED items based on the fuzzy search
                    items={loadingPaths ? [] : filteredItems}
                    // We no longer need getMatch prop here as filtering is done *before* passing items
                    // Highlighting is handled by the modified AutoComplete component internally
                    placeholder={loadingPaths ? 'Loading suggestions... Type pattern anyway' : '(e.g., src/, *.js, or select suggestion)'}
                    limit={10}
                 />
                 {/* Optional explicit loading indicator separate from placeholder */}
                 {loadingPaths && <Box marginLeft={1}><Text dimColor>Loading suggestions...</Text></Box>}
            </Box>

            {/* Footer Hint */}
            <Box paddingX={1}>
                <Text color='dim'>Enter adds files/selects suggestion. Empty Enter copies XML. ESC returns to menu.</Text>
            </Box>
        </Box>
    );
};

export default PackFilesUI;