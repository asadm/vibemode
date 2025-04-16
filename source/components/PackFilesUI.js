// source/components/PackFilesUI.js
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { globSync } from 'glob';
import fs from 'fs';
import path from 'path';
import clipboardy from 'clipboardy';
import logger from '../logger.js';
import AutoComplete from '../autocomplete.js'; // Import the AutoComplete component

const escapeXml = (unsafe) => {
     if (typeof unsafe !== 'string') {
         try { return String(unsafe); } catch (e) { logger.warn(`Warning: Could not convert value to string for XML escaping: ${unsafe}`); return ""; }
     }
     const map = {"<": "<", ">": ">", "&": "&", '"':"'", "'": "'"};
     return unsafe.replace(/[<>&"']/g, c => map[c] || c);
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
    const [localStatus, setLocalStatus] = useState("Enter glob pattern, directory name, or start typing for autocomplete. .gitignore respected.");
    const [availablePaths, setAvailablePaths] = useState([]);
    const [loadingPaths, setLoadingPaths] = useState(true);

    useEffect(() => {
        setLoadingPaths(true);
        setLocalStatus("Loading file list for autocomplete...");
        try {
            const results = globSync('**', {
                cwd: process.cwd(),
                ignore: ignorePatterns,
                mark: true,
                dot: true,
            });
            const items = results.map(p => ({ label: p.replace(/\\/g, '/') }));
            setAvailablePaths(items);
            setLocalStatus(`Loaded ${items.length} potential paths. Enter pattern/path, select suggestion, or Enter on empty to finish.`);
            logger.info(`Loaded ${items.length} paths for glob autocomplete.`);
        } catch (error) {
            logger.error("Error fetching directory structure for autocomplete:", error);
            setLocalStatus(`Error loading file list: ${error.message}. Autocomplete unavailable.`);
        } finally {
            setLoadingPaths(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);


    // --- Core Handler ---
    // This function now handles submitting ANY finalized query/path,
    // whether typed directly or selected from suggestions.
    const processQuery = (query) => {
        const trimmedQuery = query.trim();
        logger.info(`Processing query: "${trimmedQuery}"`);

        if (trimmedQuery === "" && collectedFiles.size > 0) {
            // --- Generate XML & Copy ---
            setMode("processing");
            setStatusMessage("Generating XML and preparing to copy...");
            setTimeout(() => { // Keep the timeout for UI responsiveness
                try {
                    // ... (XML generation logic - unchanged) ...
                    const filesArray = Array.from(collectedFiles).sort();
                    let dirStructure = "<directory_structure>\n";
                    filesArray.forEach(file => { dirStructure += `  ${escapeXml(file)}\n`; });
                    dirStructure += "</directory_structure>\n\n";

                    let fileContents = "<files>\n<!-- This section contains the contents of the collected files. -->\n\n";
                    filesArray.forEach(file => {
                        const filePath = path.resolve(process.cwd(), file);
                        try {
                            if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
                                logger.warn(`Skipping non-file or non-existent entry during XML generation: ${file}`);
                                fileContents += `<!-- Skipped non-file/non-existent: ${escapeXml(file)} -->\n\n`;
                                return;
                            }
                            const content = fs.readFileSync(filePath, "utf8");
                            fileContents += `<file path="${escapeXml(file)}">\n${escapeXml(content)}\n</file>\n\n`;
                        } catch (readError) {
                            fileContents += `<file path="${escapeXml(file)}" error="Could not read file: ${escapeXml(readError.message)}">\n</file>\n\n`;
                            logger.error(`Error reading ${file}: ${readError.message}`);
                        }
                    });
                    fileContents += "</files>";
                    const finalXmlContent = dirStructure + fileContents;

                    clipboardy.write(finalXmlContent).then(() => {
                        setMode("menu");
                        setStatusMessage(`XML for ${collectedFiles.size} files copied to clipboard!`);
                    }).catch(copyError => {
                        logger.error("Error copying XML to clipboard:", copyError);
                        setMode("menu");
                        setStatusMessage(`Generated XML, but failed to copy: ${copyError.message}. See logger.`);
                    });

                } catch (error) {
                    logger.error("Error generating XML content:", error);
                    setMode("menu");
                    setStatusMessage(`Error generating XML: ${error.message}. See logger.`);
                } finally {
                    // No need to clear globQuery here as we are leaving the mode
                }
            }, 50); // Short delay


        } else if (trimmedQuery !== "") {
            // --- Process glob or directory ---
            let globPatternToUse = trimmedQuery.replace(/\\/g, '/');
            let isDirectoryExpansion = false;
            const isLikelyDir = availablePaths.some(p => p.label === trimmedQuery && p.label.endsWith('/')) ||
                                (fs.existsSync(globPatternToUse) && fs.statSync(globPatternToUse).isDirectory());

            if (isLikelyDir && !globPatternToUse.endsWith('/**') && !globPatternToUse.includes('*')) {
                globPatternToUse = path.join(globPatternToUse, '**', '*').replace(/\\/g, '/');
                isDirectoryExpansion = true;
                logger.info(`Input "${trimmedQuery}" looks like directory. Using glob pattern: ${globPatternToUse}`);
            }

            try {
                const globOptions = { nodir: true, cwd: process.cwd(), ignore: ignorePatterns, dot: true, absolute: false };
                const foundFiles = globSync(globPatternToUse, globOptions).map(p => p.replace(/\\/g, '/'));
                const currentFileCount = collectedFiles.size;
                const updatedFiles = new Set([...collectedFiles, ...foundFiles]);
                const newFilesAdded = updatedFiles.size - currentFileCount;
                setCollectedFiles(updatedFiles); // Update parent state

                let message = `Found ${foundFiles.length} files matching "${globPatternToUse}"${isDirectoryExpansion ? ` (expanded from directory "${trimmedQuery}")` : ""}. Added ${newFilesAdded} new file(s). Total: ${updatedFiles.size}.`;
                message += " Enter next pattern, select suggestion, or leave empty and press Enter to finish.";
                setLocalStatus(message);
            } catch (error) {
                setLocalStatus(`Error processing glob "${globPatternToUse}"${isDirectoryExpansion ? ` (expanded from directory "${trimmedQuery}")` : ""}: ${error.message}. Please try again.`);
                logger.error(`Error processing glob "${globPatternToUse}" (original input: "${trimmedQuery}"):`, error);
            }
            setGlobQuery(""); // Clear input field after processing a pattern/path

        } else {
            // --- Empty query, no files collected yet ---
            setLocalStatus("No files collected yet. Please enter a glob pattern or directory name to find files.");
             setGlobQuery(""); // Clear input just in case
        }
    };

    // --- Handlers for AutoComplete ---

    // Called when Enter is pressed in TextInput *and* there are NO suggestions
    const handleTextSubmit = (textValue) => {
        logger.info(`Text submitted directly (no suggestions): ${textValue}`);
        processQuery(textValue); // Process the raw text
    };

    // Called when a suggestion is selected (by click OR by Enter when suggestions exist)
    const handleSuggestionSelect = (item) => {
         logger.info(`Suggestion selected (via click or Enter): ${item.label}`);
         processQuery(item.label); // Process the selected suggestion's label
    };

    // Display collected files (unchanged)
    const displayFiles = Array.from(collectedFiles).sort();
    const maxFilesToShow = 10;
    const truncated = displayFiles.length > maxFilesToShow;
    const filesString = displayFiles.slice(0, maxFilesToShow).join("\n  ") + (truncated ? `\n  ... (${collectedFiles.size - maxFilesToShow} more)` : "");
    const fileListContent = collectedFiles.size > 0
        ? <Text dimColor>{`  ${filesString}`}</Text>
        : <Text dimColor>(No files collected yet)</Text>;

    return (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor="blue" minWidth={60}>
            {/* Header and Status (unchanged) */}
            <Box paddingX={1} marginBottom={1}>
                <Text color="blue" bold>--- Pack Files: Glob Input ---</Text>
            </Box>
            {localStatus && (
                <Box paddingX={1} marginBottom={1}>
                    <Text wrap="wrap" color="yellow">{localStatus}</Text>
                </Box>
            )}

            {/* Collected Files Display (unchanged) */}
            <Box flexDirection="column" marginBottom={1} paddingX={1}>
                <Text>Collected Files ({collectedFiles.size}):</Text>
                <Box marginLeft={1}>{fileListContent}</Box>
            </Box>

            {/* AutoComplete Component */}
            <Box borderStyle="round" padding={1} marginX={1} marginBottom={1} flexDirection="column">
                <Text>Glob Pattern / Path:</Text>
                 {loadingPaths ? (
                    <Box marginLeft={1}><Text dimColor>Loading paths...</Text></Box>
                 ) : (
                    <AutoComplete
                        value={globQuery}
                        onChange={setGlobQuery}
                        onSubmit={handleTextSubmit}          // Use handler for text submission
                        onSuggestionSelect={handleSuggestionSelect} // Use handler for suggestion selection
                        items={availablePaths}
                        placeholder="(e.g., src/, *.js, my_file.txt)"
                        limit={10}
                    />
                 )}
            </Box>

             {/* Footer Hint (unchanged) */}
            <Box paddingX={1}>
                <Text color="dim">Enter adds files/selects suggestion. Empty Enter copies XML. ESC returns to menu.</Text>
            </Box>
        </Box>
    );
};

export default PackFilesUI;