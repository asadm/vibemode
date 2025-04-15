#!/usr/bin/env node
import React, { useState, useEffect, useMemo } from 'react'; // Import useMemo
import { render, Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { globSync } from 'glob';
import fs from 'fs';
import path from 'path';

// Helper function to escape XML special characters
const escapeXml = (unsafe) => {
    if (typeof unsafe !== 'string') {
        // Attempt to convert non-strings, log warning if conversion isn't straightforward
        try {
            return String(unsafe);
        } catch (e) {
             console.warn(`Warning: Could not convert value to string for XML escaping: ${unsafe}`);
            return ''; // Return empty string if conversion fails
        }
    }
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
};

const App = () => {
    const [mode, setMode] = useState('menu'); // 'menu', 'globInput', 'processing', 'done', 'error'
    const [globQuery, setGlobQuery] = useState('');
    const [collectedFiles, setCollectedFiles] = useState(new Set());
    const [statusMessage, setStatusMessage] = useState('');
    const { exit } = useApp();

    // Read and parse .gitignore once using useMemo
    const ignorePatterns = useMemo(() => {
        try {
            const gitignorePath = path.join(process.cwd(), '.gitignore');
            // Check if file exists before reading
            if (!fs.existsSync(gitignorePath)) {
                // console.log("No .gitignore file found in", process.cwd()); // Optional: uncomment for verbose logging
                return []; // No .gitignore found
            }
            // console.log("Reading .gitignore from:", gitignorePath); // Debug log (Optional: uncomment for verbose logging)
            const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');

            const parsedPatterns = gitignoreContent
                .split(/\r?\n/) // Split by newline, handling Windows/Unix endings
                .map(line => line.trim()) // Remove whitespace
                .filter(line => line && !line.startsWith('#')) // Ignore empty lines and comments
                .flatMap(line => { // Use flatMap to potentially add derived patterns
                    // If a line is a simple name (no *, !, /) assume it's a directory
                    // and add both the name itself and the recursive /** pattern.
                    // This helps glob ignore contents more reliably.
                    if (!line.includes('*') && !line.includes('/') && !line.startsWith('!')) {
                        // Return original pattern and the explicit recursive version
                        return [line, `${line}/**`];
                    }
                    // Keep other patterns (like *.log, src/, !important.txt) as is
                    return [line];
                });

            // console.log("Parsed ignore patterns:", parsedPatterns); // Debug log (Optional: uncomment for verbose logging)
            return parsedPatterns;

        } catch (error) {
            // Log error if it's something other than file not found
            if (error.code !== 'ENOENT') {
                 console.error("Warning: Could not read or parse .gitignore:", error.message);
            } else {
                 // console.log("No .gitignore file found or readable."); // Optional: uncomment for verbose logging
            }
            return []; // Proceed without ignore patterns in case of error
        }
    }, []); // Empty dependency array means this runs only once on mount

    const handleMenuSelect = (item) => {
        if (item.value === 'pack') {
            setMode('globInput');
            let initialMessage = 'Enter a glob pattern (e.g., src/**/*.js) or press Enter to finish.';
            if (ignorePatterns.length > 0) {
                initialMessage += ' (.gitignore rules are being respected)';
            }
            setStatusMessage(initialMessage);
        } else if (item.value === 'apply') {
            setStatusMessage('Apply edits feature is not implemented yet.');
            setTimeout(exit, 1000);
        } else if (item.value === 'exit') {
             exit();
        }
    };

    const handleGlobSubmit = (query) => {
        const trimmedQuery = query.trim();

        if (trimmedQuery === '' && collectedFiles.size > 0) {
            // --- Generate XML ---
            setMode('processing');
            setStatusMessage('Generating pack.xml...');
             try {
                const filesArray = Array.from(collectedFiles).sort();
                let dirStructure = '<directory_structure>\n';
                filesArray.forEach(file => { dirStructure += `  ${file}\n`; });
                dirStructure += '</directory_structure>\n\n';

                let fileContents = '<files>\nThis section contains the contents of the repository\'s files.\n\n';
                filesArray.forEach(file => {
                    const filePath = path.resolve(process.cwd(), file); // Use absolute path for reading
                    try {
                        const content = fs.readFileSync(filePath, 'utf8');
                        const escapedContent = escapeXml(content);
                        fileContents += `<file path="${escapeXml(file)}">\n${escapedContent}\n</file>\n\n`;
                    } catch (readError) {
                         // If read error, include file path but note the error
                         fileContents += `<file path="${escapeXml(file)}" error="Could not read file: ${escapeXml(readError.message)}">\n</file>\n\n`;
                         // Log non-critical warning to console, not interrupting Ink UI
                         console.error(`\nWarning: Could not read file ${file}: ${readError.message}`);
                    }
                });
                fileContents += '</files>';

                const finalXml = dirStructure + fileContents;
                fs.writeFileSync('pack.xml', finalXml);

                setMode('done');
                setStatusMessage('pack.xml created successfully!');
                setTimeout(() => exit(), 1500); // Exit after showing success message

            } catch (error) {
                setMode('error');
                setStatusMessage(`Error generating pack.xml: ${error.message}`);
                 // Log full error details to console, not just message
                 console.error("\nError generating pack.xml:", error);
                setTimeout(() => exit(error), 3000); // Exit after showing error, pass error object
            }
            // --- End XML Generation ---

        } else if (trimmedQuery !== '') {
            // Process the glob pattern, respecting .gitignore
            try {
                // console.log(`Globbing with pattern: "${trimmedQuery}" and ignore:`, ignorePatterns); // Debug Log (Optional: uncomment for verbose logging)
                const globOptions = {
                    nodir: true,            // Match only files
                    cwd: process.cwd(),     // Base directory for glob matching
                    ignore: ignorePatterns, // Pass *enhanced* parsed .gitignore patterns
                    dot: true               // Include files starting with a dot (like .env), unless ignored
                };
                const foundFiles = globSync(trimmedQuery, globOptions);

                // console.log(`Glob found ${foundFiles.length} files:`, foundFiles.slice(0, 20)); // Debug Log first 20 results (Optional: uncomment for verbose logging)

                const currentFileCount = collectedFiles.size;
                // Create a new set with existing and newly found unique files
                const updatedFiles = new Set([...collectedFiles, ...foundFiles]);
                const newFilesAdded = updatedFiles.size - currentFileCount;

                setCollectedFiles(updatedFiles);
                setGlobQuery(''); // Clear input for next glob
                let message = `Found ${foundFiles.length} files matching glob. Added ${newFilesAdded} new unique files. Total: ${updatedFiles.size}.`;
                if (ignorePatterns.length > 0) {
                    message += ' (.gitignore respected)';
                }
                 message += ' Enter another glob or press Enter to finish.';
                 setStatusMessage(message);

            } catch (error) {
                 setStatusMessage(`Error processing glob "${trimmedQuery}": ${error.message}. Please try again.`);
                 setGlobQuery(''); // Clear input
                 // Log full error details to console
                 console.error(`\nError processing glob "${trimmedQuery}":`, error);
            }
        } else {
             // Empty query and no files collected yet
             setStatusMessage('Please enter a glob pattern first, or Ctrl+C to exit.');
        }
    };

    // --- Render Logic ---

    if (mode === 'menu') {
        const items = [
            { label: 'Pack files into prompt', value: 'pack' },
            { label: 'Apply edits (Not Implemented)', value: 'apply' },
            { label: 'Exit', value: 'exit' },
        ];
        return (
            <Box flexDirection="column" padding={1}>
                <Text>Select an action:</Text>
                <SelectInput items={items} onSelect={handleMenuSelect} />
                 {statusMessage && <Text color="yellow">{statusMessage}</Text>}
            </Box>
        );
    }

    if (mode === 'globInput') {
        // Show collected files - truncated if list gets too long
        const displayFiles = Array.from(collectedFiles);
        const maxFilesToShow = 10; // Adjust as needed
        const truncated = displayFiles.length > maxFilesToShow;
        // Display sorted files for consistency
        const filesString = displayFiles
                             .sort()
                             .slice(0, maxFilesToShow)
                             .join(', ') + (truncated ? `... (${collectedFiles.size - maxFilesToShow} more)` : '');

        return (
            <Box flexDirection="column" padding={1}>
                <Text>{statusMessage}</Text>
                <Box marginTop={1} flexWrap="wrap">
                    <Text>Current files ({collectedFiles.size}): </Text>
                    {collectedFiles.size > 0 ? (
                         <Text color="gray">{filesString}</Text>
                    ) : (
                         <Text color="gray">(None yet)</Text>
                    )}
                </Box>
                 <Box borderStyle="round" paddingX={1} marginTop={1}>
                    <Text>Glob pattern: </Text>
                    <TextInput
                        value={globQuery}
                        onChange={setGlobQuery}
                        onSubmit={handleGlobSubmit}
                        placeholder="(e.g., src/**/*.js)"
                    />
                 </Box>
                 <Text color="dim">Press Enter with pattern to add files. Press Enter when empty to generate XML.</Text>
            </Box>
        );
    }

     if (mode === 'processing' || mode === 'done' || mode === 'error') {
          return (
               <Box padding={1}>
                    <Text color={mode === 'error' ? 'red' : (mode === 'done' ? 'green' : 'yellow')}>
                         {statusMessage}
                    </Text>
               </Box>
          )
     }

    // Should ideally not be reached, but return null for safety
    return null;
};

// --- Render the Ink app ---
try {
    render(<App />);
} catch (renderError) {
    console.error("Fatal Error: Could not render Ink application.", renderError);
    process.exit(1); // Exit with error code if rendering fails
}