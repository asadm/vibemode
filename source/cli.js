#!/usr/bin/env node
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { render, Box, Text, useInput, useApp, useStdin } from 'ink';
import SelectInput from 'ink-select-input';
import InkTextInput from 'ink-text-input'; // Keep for glob input
import { globSync } from 'glob';
import fs from 'fs';
import path from 'path';
import readline from 'readline'; // Needed for emitKeypressEvents
import clipboardy from 'clipboardy'; // <-- Import clipboardy
import { applyEdit, getModifiedFiles } from './editor.js'; // Ensure applyEdit is imported
import { writeDiff } from './writeDiff.js';

// Helper function to escape XML special characters
const escapeXml = (unsafe) => {
    if (typeof unsafe !== 'string') {
        try { return String(unsafe); } catch (e) { console.warn(`Warning: Could not convert value to string for XML escaping: ${unsafe}`); return ''; }
    }
    // Simple replacement map - IMPORTANT: Corrected escaping
    const map = {'<': '<', '>': '>', '&': '&', "'": '"', '"': '"'};
    return unsafe.replace(/[<>&'"]/g, c => map[c]);
};


const App = () => {
    // --- State ---
    const [mode, setMode] = useState('menu'); // 'menu', 'globInput', 'applyInput', 'processing', 'applyingEdits', 'done', 'error'
    const [globQuery, setGlobQuery] = useState('');
    const [collectedFiles, setCollectedFiles] = useState(new Set());
    const [statusMessage, setStatusMessage] = useState('');
    const [applyInputStatus, setApplyInputStatus] = useState('');
    const [countdown, setCountdown] = useState(null); // State for countdown display (3, 2, 1, null)
    const [fileEditStatus, setFileEditStatus] = useState({}); // State for tracking individual file edits: { [filePath: string]: 'pending' | 'done' | 'error' }

    // --- Hooks ---
    const { exit } = useApp();
    const { stdin, setRawMode, isRawModeSupported } = useStdin();

    // --- Refs ---
    const pasteInputRef = useRef('');
    const isHandlingRawInput = useRef(false);
    const originalRawMode = useRef(null);
    const saveTimerRef = useRef(null);
    const countdownIntervalRef = useRef(null); // Stores the ID from setInterval

    // --- Memos ---
    const ignorePatterns = useMemo(() => {
        try {
            const gitignorePath = path.join(process.cwd(), '.gitignore');
            if (!fs.existsSync(gitignorePath)) return [];
            const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
            return gitignoreContent
                .split(/\r?\n/)
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#'))
                // Basic handling for directories listed in gitignore
                .flatMap(l => (!l.includes('*') && !l.includes('/') && !l.startsWith('!')) ? [l, `${l}/**`] : [l]);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error("Warning: Could not read/parse .gitignore:", error.message);
            }
            return [];
        }
    }, []);

    // --- Input Hooks ---
    useInput((input, key) => {
        // Global Escape handler for relevant modes
        if (key.escape && (mode === 'globInput' || mode === 'applyInput')) {
            if (mode === 'applyInput') {
                // Special handling for applyInput escape
                clearSaveTimer(); // Important: Stop any pending save
                // restoreInput() will be called by the useEffect cleanup
            }
            setMode('menu');
            setGlobQuery('');
            setStatusMessage(mode === 'globInput' ? 'Glob input cancelled.' : 'Paste operation cancelled.');
            setApplyInputStatus(''); // Clear apply status too
            setFileEditStatus({}); // Clear file edit status on escape
        }
    }, {
        // Apply this hook only when in globInput or applyInput mode
        isActive: mode === 'globInput' || mode === 'applyInput'
    });

    // --- Helper Functions ---
    const clearSaveTimer = () => {
        // Clear the save timeout first
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        // Clear the countdown interval
        if (countdownIntervalRef.current) {
             clearInterval(countdownIntervalRef.current);
             countdownIntervalRef.current = null; // Clear the ref immediately
        }
        // Always attempt to set countdown state to null when timers are cleared.
        setCountdown(null);
    };

    // Make sure status messages are always strings to prevent React errors
    const setSafeStatusMessage = (msg) => setStatusMessage(String(msg ?? ''));
    const setSafeApplyInputStatus = (msg) => setApplyInputStatus(String(msg ?? ''));

    // --- Effect for Raw Input Handling (Apply Mode) ---
    useEffect(() => {
        // Defined within useEffect to capture dependencies correctly
        const restoreInput = () => {
             if (!isHandlingRawInput.current) return;
             clearSaveTimer(); // Ensure timer is cleared on cleanup
             if (stdin) {
                 stdin.removeListener('keypress', handleKeyPress);
                 if (typeof originalRawMode.current === 'boolean' && typeof setRawMode === 'function') {
                     try { setRawMode(originalRawMode.current); } catch (error) { console.error("Cleanup Error setting raw mode:", error); }
                 }
             }
             isHandlingRawInput.current = false;
             originalRawMode.current = null;
            // Don't clear applyInputStatus here, let handlePasteSave or escape handler manage it
         };

         const handleKeyPress = (str, key) => {
           // ANY key press cancels the pending save (except Enter itself which restarts it)
           if (key?.name !== 'return') {
             clearSaveTimer(); // Clears timers AND sets countdown state to null
           }

           if (!key) { return; } // Should generally not happen with emitKeypressEvents
           if (key.ctrl && key.name === 'c') { restoreInput(); exit(new Error("Interrupted by Ctrl+C.")); return; }
           // Escape is handled by the general useInput hook now

           const isEnter = key.name === 'return';

           if (isEnter) { // Start/Restart countdown/timer
               clearSaveTimer(); // Clear any existing timers first
               pasteInputRef.current += '\n';
               setSafeApplyInputStatus(`Input pause detected. Finalizing...`);
               setCountdown(3); // Start display at 3

               // Interval with Self-Check
               const intervalId = setInterval(() => {
                   // Check if this specific interval is still the current one
                   if (countdownIntervalRef.current !== intervalId) {
                       clearInterval(intervalId); // Stop this interval if it's been superseded
                       return;
                    }
                   setCountdown(prev => (prev !== null && prev > 1 ? prev - 1 : null));
               }, 500);
               countdownIntervalRef.current = intervalId; // Store the new interval ID

               // Save Timeout (associated with the current Enter press)
               saveTimerRef.current = setTimeout(() => {
                    // Check if this timeout corresponds to the latest interval
                    if (countdownIntervalRef.current === intervalId) {
                        clearInterval(countdownIntervalRef.current);
                        countdownIntervalRef.current = null;
                    }
                    saveTimerRef.current = null; // Clear this timeout ref
                    setCountdown(null); // Ensure UI state is cleared

                    const contentToSave = pasteInputRef.current;
                    restoreInput(); // Clean up raw mode etc. *before* potentially slow save
                    handlePasteSave(contentToSave); // <<-- Call the modified handler
               }, 1500); // Shortened countdown timer (3 * 500ms)

           } else { // Handle other non-Enter keys
                // Countdown is already cleared by clearSaveTimer() at the top of handleKeyPress if needed
                let statusUpdate = `Pasting... Len: ${pasteInputRef.current.length}.`;
                if (key.name === 'backspace') {
                    if (pasteInputRef.current.length > 0) {
                        pasteInputRef.current = pasteInputRef.current.slice(0, -1);
                        statusUpdate = `Pasting... Len: ${pasteInputRef.current.length}. Save cancelled.`;
                    } else {
                        statusUpdate = `Paste buffer empty. Save cancelled.`;
                    }
                } else if (key.name === 'tab') {
                    pasteInputRef.current += '    '; // Add spaces for tab
                    statusUpdate = `Pasting... Len: ${pasteInputRef.current.length}. Save cancelled.`;
                } else if (str && !key.ctrl && !key.meta && !key.escape && key.name !== 'escape') { // Filter out control keys etc.
                    pasteInputRef.current += str;
                    statusUpdate = `Pasting... Len: ${pasteInputRef.current.length}. Save cancelled.`;
                } else {
                    // Some other key was pressed (like shift, ctrl, etc.) - maybe don't update status or provide specific feedback
                    statusUpdate = `Key '${key.name || str}' pressed. Save cancelled. Pasting... Len: ${pasteInputRef.current.length}.`;
                }

                setSafeApplyInputStatus(statusUpdate);
           }
       };

        // Effect Setup Logic
        if (mode === 'applyInput') {
             if (!stdin || !isRawModeSupported || typeof setRawMode !== 'function') {
                 setMode('menu'); setSafeStatusMessage("Error: Raw mode not supported/unavailable."); return;
             }
             if (isHandlingRawInput.current) { return; } // Avoid re-setup

             isHandlingRawInput.current = true;
             pasteInputRef.current = ''; // Clear previous paste content
             setSafeApplyInputStatus('Ready. Paste content now. Press Enter when finished.');
             setSafeStatusMessage(''); // Clear general status
             setFileEditStatus({}); // Clear file edit status on entering apply mode
             originalRawMode.current = stdin.isRaw;

             try {
                 setRawMode(true);
                 readline.emitKeypressEvents(stdin); // Ensure keypress events are emitted
                 stdin.on('keypress', handleKeyPress); // Attach listener
             } catch (error) {
                 console.error("Setup Error setting raw mode:", error);
                 restoreInput(); // Attempt cleanup
                 setMode('menu');
                 setSafeStatusMessage("Error: Failed to set raw mode.");
                 return;
             }
        } else {
             // Cleanup if mode changes *away* from applyInput
             if (isHandlingRawInput.current) {
                 restoreInput();
             }
        }

        // Return the cleanup function for when the component unmounts or dependencies change
        return restoreInput;

    }, [mode, stdin, setRawMode, isRawModeSupported, exit]); // Dependencies for the effect


    // --- Action Handlers ---

    const handleMenuSelect = (item) => {
        clearSaveTimer(); // Clear timer if user selects menu item during countdown
        setSafeStatusMessage('');
        setSafeApplyInputStatus('');
        setFileEditStatus({}); // Clear file edit status when returning to menu
        if (item.value === 'pack') {
             setMode('globInput');
            let msg = 'Enter glob pattern(s). .gitignore rules are applied.';
            setSafeStatusMessage(msg);
            setCollectedFiles(new Set()); // Reset files when entering pack mode
            setGlobQuery('');
        } else if (item.value === 'apply') {
            if (!isRawModeSupported) { setMode('menu'); setSafeStatusMessage("Raw mode not supported for 'Apply'."); return; }
            setMode('applyInput'); // useEffect will handle setup
        } else if (item.value === 'exit') {
            exit();
        }
    };

    const handleGlobSubmit = (query) => {
        const trimmedQuery = query.trim();

        if (trimmedQuery === '' && collectedFiles.size > 0) { // Generate XML & Copy to Clipboard
            setMode('processing');
            setSafeStatusMessage('Generating XML and preparing to copy...');

            // Use setTimeout to allow Ink to render the "processing" message before sync operations
            setTimeout(() => {
                try {
                    const filesArray = Array.from(collectedFiles).sort();
                    let dirStructure = '<directory_structure>\n';
                    filesArray.forEach(file => { dirStructure += `  ${escapeXml(file)}\n`; }); // Escape file paths here too, just in case
                    dirStructure += '</directory_structure>\n\n';

                    let fileContents = '<files>\n<!-- This section contains the contents of the collected files. -->\n\n';
                    filesArray.forEach(file => {
                        const filePath = path.resolve(process.cwd(), file);
                        try {
                             const stat = fs.statSync(filePath);
                             if (!stat.isFile()) {
                                 console.warn(`\nWarn: Skipping non-file entry during XML generation: ${file}`);
                                 fileContents += `<!-- Skipped non-file entry: ${escapeXml(file)} -->\n\n`;
                                 return;
                            }
                            const content = fs.readFileSync(filePath, 'utf8');
                            // Use the corrected escapeXml function
                            fileContents += `<file path="${escapeXml(file)}">\n${escapeXml(content)}\n</file>\n\n`;
                        } catch (readError) {
                            fileContents += `<file path="${escapeXml(file)}" error="Could not read file: ${escapeXml(readError.message)}">\n</file>\n\n`;
                            console.error(`\nWarn: Could not read ${file}: ${readError.message}`);
                        }
                    });
                    fileContents += '</files>';

                    const finalXmlContent = dirStructure + fileContents;

                    // --- Copy to Clipboard ---
                    clipboardy.write(finalXmlContent).then(() => {
                        setMode('menu'); // Return to menu on success
                        setSafeStatusMessage(`XML for ${collectedFiles.size} files copied to clipboard!`);
                    }).catch(copyError => {
                        console.error("\nError copying XML to clipboard:", copyError);
                        setMode('menu'); // Still return to menu on copy error
                        setSafeStatusMessage(`Generated XML, but failed to copy: ${copyError.message}. See console.`);
                    });
                    // ------------------------

                } catch (error) { // Handle XML generation error
                    console.error("\nError generating XML content:", error);
                    setMode('menu'); // Return to menu on generation error
                    setSafeStatusMessage(`Error generating XML: ${error.message}. See console.`);
                }
            }, 50); // Small delay for UI update

        } else if (trimmedQuery !== '') { // Process glob (unchanged)
            try {
                // Ensure ignore patterns are fresh if needed, though useMemo handles this
                const globOptions = { nodir: true, cwd: process.cwd(), ignore: ignorePatterns, dot: true };
                const foundFiles = globSync(trimmedQuery, globOptions);
                const currentFileCount = collectedFiles.size;
                const updatedFiles = new Set([...collectedFiles, ...foundFiles]); // Add new files to the set
                const newFilesAdded = updatedFiles.size - currentFileCount;
                setCollectedFiles(updatedFiles);

                let message = `Found ${foundFiles.length} matches for "${trimmedQuery}". Added ${newFilesAdded} new file(s). Total: ${updatedFiles.size}.`;
                if (ignorePatterns.length > 0) message += ' (.gitignore respected)';
                message += ' Enter next glob or leave empty and press Enter to finish.';
                setSafeStatusMessage(message);
            } catch (error) { // Handle glob error
                setSafeStatusMessage(`Error processing glob "${trimmedQuery}": ${error.message}. Please try again.`);
                console.error(`\nError processing glob "${trimmedQuery}":`, error);
            }
            setGlobQuery(''); // Clear input field after submission
        } else { // Empty query, no files collected yet (unchanged)
            setSafeStatusMessage('No files collected yet. Please enter a glob pattern to find files.');
        }
    };


    // --- MODIFIED: handlePasteSave ---
    const handlePasteSave = async (contentToSave) => {
        const trimmedContent = String(contentToSave ?? '').trim();
        if (!trimmedContent) {
             setMode('menu');
             setSafeStatusMessage('Paste cancelled: No content provided.');
             setFileEditStatus({}); // Clear status
             return;
        }

        setMode('processing'); // Show brief processing state
        setSafeStatusMessage('Parsing pasted content to identify files...');

        try {
            // 1. Get file paths from the pasted content
            const { filePaths } = await getModifiedFiles(trimmedContent);

            if (!filePaths || filePaths.length === 0) {
                setMode('menu');
                setSafeStatusMessage('No files identified for modification in the pasted content.');
                setFileEditStatus({}); // Clear status
                return;
            }

            // 2. Initialize status for all identified files to 'pending'
            const initialStatus = filePaths.reduce((acc, fp) => {
                acc[fp] = 'pending';
                return acc;
            }, {});
            setFileEditStatus(initialStatus);

            // 3. Switch to the 'applyingEdits' mode to show the progress UI
            setMode('applyingEdits');
            setSafeStatusMessage(`Applying edits to ${filePaths.length} file(s)...`);

            // 4. Process each file asynchronously
            const editPromises = filePaths.map(async (filePath) => {
                try {
                    const result = await applyEdit(trimmedContent, filePath); // Apply the edit
                    const errors = await writeDiff(filePath, result);
                    if (errors) {
                        // We retry one more time along with error as reported by writeDiff
                        const retryResult = await applyEdit(trimmedContent, filePath, result, errors);
                        const retryErrors = await writeDiff(filePath, retryResult);
                        if (retryErrors) {
                            console.error(`\nError applying edit to ${filePath}:`, retryErrors);
                            throw new Error(retryErrors);
                        }
                    }
                    // Update state for *this* file to 'done' on success
                    // Use functional update to avoid race conditions with rapid updates
                    setFileEditStatus(prevStatus => ({ ...prevStatus, [filePath]: 'done' }));
                    return { filePath, success: true, result: result || '(No output)' }; // Collect result
                } catch (error) {
                    console.error(`\nError applying edit to ${filePath}:`, error);
                    // Update state for *this* file to 'error' on failure
                    setFileEditStatus(prevStatus => ({ ...prevStatus, [filePath]: 'error' }));
                    return { filePath, success: false, error: error.message || String(error) }; // Collect error
                }
            });

            // 5. Wait for all edit attempts to complete
            const results = await Promise.all(editPromises);

            // 6. Aggregate results (success and errors)
            const successfulEdits = results.filter(r => r.success);
            const failedEdits = results.filter(r => !r.success);
            const aggregatedResults = results.map(r =>
                r.success
                    ? `--- Success: ${r.filePath} ---\n${r.result}\n--- End: ${r.filePath} ---`
                    : `--- Error: ${r.filePath} ---\n${r.error}\n--- End: ${r.filePath} ---`
            ).join('\n\n');

            // 7. Save aggregated results to paste.txt
            fs.writeFile('paste.txt', aggregatedResults, (writeError) => {
                let finalMessage;
                if (writeError) {
                     console.error("\nError saving aggregated results to paste.txt:", writeError);
                     finalMessage = `Edits applied (${successfulEdits.length} success, ${failedEdits.length} failed), but failed to save results to paste.txt: ${writeError.message}`;
                     setMode('error'); // Keep error state briefly
                } else {
                     finalMessage = `Applied edits to ${successfulEdits.length} file(s). Results saved to paste.txt.`;
                     if (failedEdits.length > 0) {
                         finalMessage += ` Failed edits for ${failedEdits.length} file(s) (see paste.txt and console).`;
                         setMode('error'); // Show error state if any file failed
                     } else {
                         setMode('done'); // Show success state
                     }
                }
                setSafeStatusMessage(finalMessage); // Update status with summary

                // 8. Return to menu after a delay
                setTimeout(() => {
                    setMode('menu');
                    // Status message is already set, keep it for context on menu screen
                    setFileEditStatus({}); // Clear the file status for the next run
                }, failedEdits.length > 0 || writeError ? 4000 : 2500); // Longer delay if there were errors
            });

        } catch (error) {
             // Handle errors during getModifiedFiles or initial setup
             console.error("\nError processing pasted content for edits:", error);
             setMode('error'); // Show error state
             setSafeStatusMessage(`Error preparing edits: ${error.message}. Operation cancelled.`);
             setFileEditStatus({}); // Clear status
             setTimeout(() => { setMode('menu'); setSafeStatusMessage(''); }, 3000); // Return to menu after error display
        }
     };


    // --- Render Logic ---

    // Render Menu
    if (mode === 'menu') {
        const items = [
            { label: 'Pack files (copy XML)', value: 'pack' }, // Updated label
            { label: 'Apply edits from paste', value: 'apply' },
            { label: 'Exit', value: 'exit' },
        ];
        return (
            <Box flexDirection="column" padding={1} minWidth={60}>
                 {statusMessage && ( // Display status message above menu if present
                    <Box paddingX={1} marginBottom={1} borderStyle="round" borderColor="yellow">
                        <Text color="yellow" wrap="wrap">{statusMessage}</Text>
                    </Box>
                )}
                <Box flexDirection="column" padding={1} borderStyle="single">
                    <Text bold>Select Action:</Text>
                    <Box marginTop={1}>
                        <SelectInput items={items} onSelect={handleMenuSelect} />
                    </Box>
                </Box>
            </Box>
        );
    }

    // Render Glob Input (Pack Files)
    if (mode === 'globInput') {
         const displayFiles = Array.from(collectedFiles).sort();
         const maxFilesToShow = 10;
         const truncated = displayFiles.length > maxFilesToShow;
         const filesString = displayFiles.slice(0, maxFilesToShow).join('\n  ') + (truncated ? `\n  ... (${collectedFiles.size - maxFilesToShow} more)` : '');

         const fileListContent = collectedFiles.size > 0
            ? <Text dimColor>{`  ${filesString}`}</Text>
            : <Text dimColor>(No files collected yet)</Text>;

        return (
            <Box flexDirection="column" padding={1} borderStyle="round" borderColor="blue" minWidth={60}>
                {/* Title */}
                <Box paddingX={1} marginBottom={1}>
                    <Text color="blue" bold>--- Pack Files: Glob Input ---</Text>
                </Box>

                {/* Status Message */}
                {statusMessage && (
                    <Box paddingX={1} marginBottom={1}>
                        <Text wrap="wrap" color="yellow">{statusMessage}</Text>
                    </Box>
                )}

                {/* Collected Files Display */}
                <Box flexDirection="column" marginBottom={1} paddingX={1}>
                    <Text>Collected Files ({collectedFiles.size}):</Text>
                    <Box marginLeft={1}>{fileListContent}</Box>
                </Box>

                {/* Input Area */}
                 <Box borderStyle="round" paddingX={1} marginX={1} marginBottom={1}>
                    <Text>Glob Pattern:</Text>
                    <InkTextInput
                        value={globQuery}
                        onChange={setGlobQuery}
                        onSubmit={handleGlobSubmit}
                        placeholder="(e.g., src/**/*.js, *.md)"
                        // focus={true} // Usually automatically focused
                    />
                 </Box>

                 {/* Help Text */}
                 <Box paddingX={1}>
                     {/* Updated help text */}
                     <Text color="dim">Press Enter to add files. Leave empty and press Enter to copy XML to clipboard. Press ESC to return to menu.</Text>
                 </Box>
             </Box>
        );
    }

    // Render Apply Input (Paste Mode)
    if (mode === 'applyInput') {
        // Show only the last N characters for preview, avoid showing huge pastes
        const previewLength = 300;
        const currentPasteContent = pasteInputRef.current ?? '';
        const previewText = currentPasteContent.length > previewLength
            ? `...${currentPasteContent.slice(-previewLength)}`
            : currentPasteContent;

        return (
            <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan" minWidth={60}>
                 {/* Title */}
                <Box paddingX={1} marginBottom={1}>
                    <Text color="cyan" bold>--- Apply Edits: Paste Mode ---</Text>
                </Box>

                {/* Status (dynamic updates) */}
                {applyInputStatus && (
                    <Box paddingX={1} marginBottom={1}>
                        <Text wrap="wrap">{applyInputStatus}</Text>
                    </Box>
                )}

                {/* Countdown Display (only when countdown is active) */}
                {countdown !== null && (
                    <Box marginTop={1} marginBottom={1} marginX={1} borderColor="yellow" borderStyle="single" paddingX={1} alignSelf="flex-start">
                        <Text color="yellow"> Finalizing... Saving in {countdown} </Text>
                    </Box>
                )}

                {/* Paste Preview Area */}
                <Box marginX={1} marginBottom={1} padding={1} borderStyle="single" borderColor="gray" minHeight={5}>
                     <Text dimColor wrap="end">{previewText || '(Paste content here...)'}</Text>
                </Box>

                {/* Help Text */}
                <Box paddingX={1}>
                    <Text color="dim">Paste content now. Press Enter when finished. Save triggers after 1.5s pause. Any key cancels save. ESC returns to menu.</Text>
                </Box>
            </Box>
        );
     }

    // --- NEW: Render Applying Edits Progress ---
    if (mode === 'applyingEdits') {
        const statusIndicators = {
            pending: '⏳', // Loading emoji
            done: '✅',   // Checkmark
            error: '❌',   // Cross mark
        };
        // Get file paths in a consistent order for display
        const sortedFilePaths = Object.keys(fileEditStatus).sort();

        return (
            <Box flexDirection="column" padding={1} borderStyle="round" borderColor="magenta" minWidth={60}>
                {/* Status Message */}
                {statusMessage && (
                    <Box paddingX={1} marginBottom={1}>
                        <Text wrap="wrap" color="magenta">{statusMessage}</Text>
                    </Box>
                )}

                {/* File List */}
                <Box flexDirection="column" paddingX={1}>
                    <Text bold>Applying Edits:</Text>
                    {sortedFilePaths.length === 0 && <Text dimColor> (Identifying files...)</Text>}
                    {sortedFilePaths.map((filePath) => {
                        const status = fileEditStatus[filePath];
                        const indicator = statusIndicators[status] || '?';
                        return (
                            <Box key={filePath} marginLeft={1}>
                                <Text>
                                    {indicator}{' '}
                                    <Text color={status === 'error' ? 'red' : undefined}>{filePath}</Text>
                                </Text>
                            </Box>
                        );
                    })}
                </Box>
            </Box>
        );
    }


     // Render Processing/Done/Error states (Used by both Pack and Apply)
     if (mode === 'processing' || mode === 'done' || mode === 'error') {
          const borderColor = mode === 'error' ? 'red' : (mode === 'done' ? 'green' : 'yellow');
          const message = statusMessage; // Just use the current status message

          return (
               <Box padding={1} borderStyle="round" borderColor={borderColor} minWidth={60}>
                    <Text color={borderColor} wrap="wrap">
                         {message || (mode === 'processing' ? 'Processing...' : (mode === 'done' ? 'Done.' : 'Error.'))}
                    </Text>
               </Box>
          )
     }

    // Fallback render for unexpected modes
    return (<Box padding={1}><Text color="red">Error: Invalid application mode '{mode}'</Text></Box>);
};

// --- Render the Ink application ---
try {
    // Ensure terminal is large enough or provide guidance? (Optional)
    render(<App />);
} catch (renderError) {
    console.error("Fatal Error rendering Ink application.", renderError);
    process.exit(1);
}