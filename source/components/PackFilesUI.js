// source/components/PackFilesUI.js
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import InkTextInput from 'ink-text-input';
import PropTypes from 'prop-types';
import { globSync } from 'glob';
import fs from 'fs';
import path from 'path';
import clipboardy from 'clipboardy';
import logger from '../logger.js';

// Helper function moved here as it's only used for packing now
const escapeXml = (unsafe) => {
     if (typeof unsafe !== 'string') {
         try { return String(unsafe); } catch (e) { logger.warn(`Warning: Could not convert value to string for XML escaping: ${unsafe}`); return ""; }
     }
     const map = {"<": "<", ">": ">", "&": "&", '"':'"', "'": "'"}; // Added single quote just in case
     return unsafe.replace(/[<>&"']/g, c => map[c] || c); // Fallback to original char if not in map
};

const PackFilesUI = ({
    collectedFiles,
    setCollectedFiles,
    setMode,
    setStatusMessage,
    ignorePatterns,
    onEscape, // Function to call when Esc is pressed
}) => {
    const [globQuery, setGlobQuery] = useState('');
    const [localStatus, setLocalStatus] = useState("Enter glob pattern(s) or directory name. .gitignore rules are applied.");

    // Use the global useInput hook for Escape, passed down via onEscape prop
    // No need for local useInput here if Escape is handled globally

    const handleGlobSubmit = (query) => {
        const trimmedQuery = query.trim();

        if (trimmedQuery === "" && collectedFiles.size > 0) { // Generate XML & Copy
            setMode("processing");
            setStatusMessage("Generating XML and preparing to copy...");

            setTimeout(() => {
                try {
                    const filesArray = Array.from(collectedFiles).sort();
                    let dirStructure = "<directory_structure>\n";
                    filesArray.forEach(file => { dirStructure += `  ${escapeXml(file)}\n`; });
                    dirStructure += "</directory_structure>\n\n";

                    let fileContents = "<files>\n<!-- This section contains the contents of the collected files. -->\n\n";
                    filesArray.forEach(file => {
                        const filePath = path.resolve(process.cwd(), file);
                        try {
                            const stat = fs.statSync(filePath);
                            if (!stat.isFile()) {
                                logger.warn(`\nWarn: Skipping non-file entry during XML generation: ${file}`);
                                fileContents += `<!-- Skipped non-file entry: ${escapeXml(file)} -->\n\n`;
                                return;
                            }
                            const content = fs.readFileSync(filePath, "utf8");
                            fileContents += `<file path="${escapeXml(file)}">\n${escapeXml(content)}\n</file>\n\n`;
                        } catch (readError) {
                            fileContents += `<file path="${escapeXml(file)}" error="Could not read file: ${escapeXml(readError.message)}">\n</file>\n\n`;
                            logger.error(`\nWarn: Could not read ${file}: ${readError.message}`);
                        }
                    });
                    fileContents += "</files>";
                    const finalXmlContent = dirStructure + fileContents;

                    clipboardy.write(finalXmlContent).then(() => {
                        setMode("menu");
                        setStatusMessage(`XML for ${collectedFiles.size} files copied to clipboard!`);
                    }).catch(copyError => {
                        logger.error("\nError copying XML to clipboard:", copyError);
                        setMode("menu");
                        setStatusMessage(`Generated XML, but failed to copy: ${copyError.message}. See logger.`);
                    });

                } catch (error) {
                    logger.error("\nError generating XML content:", error);
                    setMode("menu");
                    setStatusMessage(`Error generating XML: ${error.message}. See logger.`);
                }
            }, 50);

        } else if (trimmedQuery !== "") { // Process glob or directory
            let globPatternToUse = trimmedQuery;
            let isDirectoryExpansion = false;

            try {
                const potentialDirPath = path.resolve(process.cwd(), trimmedQuery);
                if (fs.existsSync(potentialDirPath) && fs.statSync(potentialDirPath).isDirectory()) {
                    globPatternToUse = path.join(trimmedQuery, "**", "*").replace(/\\/g, "/");
                    isDirectoryExpansion = true;
                    logger.info(`Input "${trimmedQuery}" detected as directory. Using glob pattern: ${globPatternToUse}`);
                }
            } catch (statError) {
                 logger.warn(`Could not stat input "${trimmedQuery}" to check if it's a directory: ${statError.message}. Proceeding with original query.`);
            }

            try {
                const globOptions = { nodir: true, cwd: process.cwd(), ignore: ignorePatterns, dot: true };
                const foundFiles = globSync(globPatternToUse, globOptions);
                const currentFileCount = collectedFiles.size;
                const updatedFiles = new Set([...collectedFiles, ...foundFiles]);
                const newFilesAdded = updatedFiles.size - currentFileCount;
                setCollectedFiles(updatedFiles); // Update parent state

                let message = `Found ${foundFiles.length} matches for "${globPatternToUse}"${isDirectoryExpansion ? ` (expanded from directory "${trimmedQuery}")` : ""}. Added ${newFilesAdded} new file(s). Total: ${updatedFiles.size}.`;
                if (ignorePatterns.length > 0) message += " (.gitignore respected)";
                message += " Enter next glob or leave empty and press Enter to finish.";
                setLocalStatus(message); // Update local status
            } catch (error) {
                setLocalStatus(`Error processing glob "${globPatternToUse}"${isDirectoryExpansion ? ` (expanded from directory "${trimmedQuery}")` : ""}: ${error.message}. Please try again.`);
                logger.error(`\nError processing glob "${globPatternToUse}" (original input: "${trimmedQuery}"):`, error);
            }
            setGlobQuery(""); // Clear input field

        } else { // Empty query, no files
            setLocalStatus("No files collected yet. Please enter a glob pattern or directory name to find files.");
        }
    };

    // Display collected files
    const displayFiles = Array.from(collectedFiles).sort();
    const maxFilesToShow = 10;
    const truncated = displayFiles.length > maxFilesToShow;
    const filesString = displayFiles.slice(0, maxFilesToShow).join("\n  ") + (truncated ? `\n  ... (${collectedFiles.size - maxFilesToShow} more)` : "");

    const fileListContent = collectedFiles.size > 0
        ? <Text dimColor>{`  ${filesString}`}</Text>
        : <Text dimColor>(No files collected yet)</Text>;

    return (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor="blue" minWidth={60}>
            <Box paddingX={1} marginBottom={1}>
                <Text color="blue" bold>--- Pack Files: Glob Input ---</Text>
            </Box>

            {localStatus && (
                <Box paddingX={1} marginBottom={1}>
                    <Text wrap="wrap" color="yellow">{localStatus}</Text>
                </Box>
            )}

            <Box flexDirection="column" marginBottom={1} paddingX={1}>
                <Text>Collected Files ({collectedFiles.size}):</Text>
                <Box marginLeft={1}>{fileListContent}</Box>
            </Box>

            <Box borderStyle="round" paddingX={1} marginX={1} marginBottom={1}>
                <Text>Glob Pattern:</Text>
                <InkTextInput
                    value={globQuery}
                    onChange={setGlobQuery}
                    onSubmit={handleGlobSubmit}
                    placeholder="(e.g., src/**/*.js, *.md, my_dir)" // Updated placeholder
                />
            </Box>

            <Box paddingX={1}>
                <Text color="dim">Press Enter to add files. Leave empty and press Enter to copy XML. Press ESC to return to menu.</Text>
            </Box>
        </Box>
    );
};

PackFilesUI.propTypes = {
    collectedFiles: PropTypes.instanceOf(Set).isRequired,
    setCollectedFiles: PropTypes.func.isRequired,
    setMode: PropTypes.func.isRequired,
    setStatusMessage: PropTypes.func.isRequired, // For setting messages on mode change
    ignorePatterns: PropTypes.array.isRequired,
    onEscape: PropTypes.func.isRequired, // Callback for Escape key
};

export default PackFilesUI;