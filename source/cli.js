#!/usr/bin/env node
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { render, Box, Text, useInput, useApp, useStdin } from 'ink';
import SelectInput from 'ink-select-input';
import InkTextInput from 'ink-text-input'; // Keep for glob input
import { globSync } from 'glob';
import fs from 'fs';
import path from 'path';
import readline from 'readline'; // Needed for emitKeypressEvents

// Helper function to escape XML special characters
const escapeXml = (unsafe) => {
    if (typeof unsafe !== 'string') {
        try { return String(unsafe); } catch (e) { console.warn(`Warning: Could not convert value to string for XML escaping: ${unsafe}`); return ''; }
    }
    // Use a map for replacement for clarity and potential performance
    return unsafe.replace(/[<>&'"]/g, c => ({'<':'<', '>':'>', '&':'&', '\'':"'", '"':'"'}[c] || c));
};

const App = () => {
    // --- State ---
    const [mode, setMode] = useState('menu');
    const [globQuery, setGlobQuery] = useState('');
    const [collectedFiles, setCollectedFiles] = useState(new Set());
    const [statusMessage, setStatusMessage] = useState('');
    const [applyInputStatus, setApplyInputStatus] = useState('');
    const [countdown, setCountdown] = useState(null); // State for countdown display (3, 2, 1, null)

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
        if (key.escape && mode === 'globInput') {
            setMode('menu');
            setGlobQuery('');
            setStatusMessage('');
        }
    }, {
        isActive: mode === 'globInput'
    });

    // --- Helper Functions ---
    const clearSaveTimer = () => {
        let didClearTimers = false;
        if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; didClearTimers = true; }
        if (countdownIntervalRef.current) {
             // console.log(`[clearSaveTimer] Clearing Interval ID: ${countdownIntervalRef.current}`); // Optional Log
             clearInterval(countdownIntervalRef.current);
             countdownIntervalRef.current = null; // Clear the ref immediately
             didClearTimers = true;
        }
        if (countdown !== null) {
             // console.log(`[clearSaveTimer] Countdown state is ${countdown}. Setting to null.`); // Optional Log
             setCountdown(null); // Reset UI state
        } else if (didClearTimers) { /* Optional log if timers cleared but UI was already null */ }
    };

    const setSafeStatusMessage = (msg) => setStatusMessage(String(msg ?? ''));
    const setSafeApplyInputStatus = (msg) => setApplyInputStatus(String(msg ?? ''));

    // --- Effect for Raw Input Handling ---
    useEffect(() => {
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
             setSafeApplyInputStatus('');
         };

         const handleKeyPress = (str, key) => {
            // --- ANY key press cancels the pending save ---
            clearSaveTimer(); // Clears timers AND attempts to setCountdown(null)

           if (!key) { return; }
           if (key.ctrl && key.name === 'c') { restoreInput(); exit(new Error("Interrupted by Ctrl+C.")); return; }
           if (key.escape || key.name === 'escape') { restoreInput(); setMode('menu'); setSafeStatusMessage('Paste operation cancelled.'); return; }

           const isEnter = key.name === 'return';

           if (isEnter) { // Start countdown/timer
               pasteInputRef.current += '\n';
               setSafeApplyInputStatus(`Input pause detected. Finalizing...`);
               setCountdown(3); // Start display at 3

               // Interval with Self-Check
               const intervalId = setInterval(() => {
                   if (countdownIntervalRef.current !== intervalId) { clearInterval(intervalId); return; }
                   setCountdown(prev => (prev !== null && prev > 1 ? prev - 1 : null));
               }, 500);
               countdownIntervalRef.current = intervalId;

               // Save Timeout
               saveTimerRef.current = setTimeout(() => {
                   if (countdownIntervalRef.current) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null; }
                   saveTimerRef.current = null;
                   setCountdown(null); // Ensure state cleared on timeout completion

                   const contentToSave = pasteInputRef.current;
                   restoreInput();
                   handlePasteSave(contentToSave);
               }, 3000);

           } else { // Handle other non-Enter keys
                // --- Explicitly set countdown to null here ---
                // Even though clearSaveTimer was called, this makes it definitive
                // for this code path.
                setCountdown(null);
                // --------------------------------------------

                let statusUpdate = `Pasting... Len: ${pasteInputRef.current.length}.`;
                if (key.name === 'backspace') {
                    if (pasteInputRef.current.length > 0) {
                        pasteInputRef.current = pasteInputRef.current.slice(0, -1);
                    }
                    statusUpdate = `Save cancelled. Pasting... Len: ${pasteInputRef.current.length}.`;
                } else if (key.name === 'tab') {
                    pasteInputRef.current += '    ';
                } else if (str && !key.ctrl && !key.meta && !key.escape) {
                    pasteInputRef.current += str;
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
             pasteInputRef.current = '';
             setSafeApplyInputStatus('Ready. Paste content. Press Enter when done. Save triggers after 3s pause. ESC cancels.');
             originalRawMode.current = stdin.isRaw;

             try { setRawMode(true); }
             catch(error) { console.error("Setup Error setting raw mode:", error); isHandlingRawInput.current = false; setMode('menu'); setSafeStatusMessage("Error: Failed to set raw mode."); return; }

             readline.emitKeypressEvents(stdin);
             stdin.on('keypress', handleKeyPress);
        } else {
             if (isHandlingRawInput.current) { restoreInput(); } // Cleanup if mode changes
        }
        return restoreInput; // Return cleanup function

    }, [mode, stdin, setRawMode, isRawModeSupported, exit]); // Dependencies


    // --- Action Handlers ---

    const handleMenuSelect = (item) => {
        clearSaveTimer(); // Clear timer if user selects menu item during countdown
        setSafeStatusMessage('');
        setSafeApplyInputStatus('');
        if (item.value === 'pack') {
             setMode('globInput');
            let msg = 'Enter glob pattern or Enter to finish.';
            if (ignorePatterns.length > 0) msg += ' (.gitignore respected)';
            msg += ' ESC=menu.';
            setSafeStatusMessage(msg);
            setCollectedFiles(new Set()); setGlobQuery('');
        } else if (item.value === 'apply') {
            if (!isRawModeSupported) { setMode('menu'); setSafeStatusMessage("Raw mode not supported."); return; }
            setMode('applyInput');
        } else if (item.value === 'exit') {
            exit();
        }
    };

    const handleGlobSubmit = (query) => {
        const trimmedQuery = query.trim();
        if (trimmedQuery === '' && collectedFiles.size > 0) { // Generate XML
            setMode('processing'); setSafeStatusMessage('Generating pack.xml...');
            try {
                const filesArray = Array.from(collectedFiles).sort();
                let dirStructure = '<directory_structure>\n';
                filesArray.forEach(file => { dirStructure += `  ${file}\n`; });
                dirStructure += '</directory_structure>\n\n';
                let fileContents = '<files>\nThis section contains the contents of the repository\'s files.\n\n';
                filesArray.forEach(file => {
                    const filePath = path.resolve(process.cwd(), file);
                    try {
                         const stat = fs.statSync(filePath); if (!stat.isFile()) { console.warn(`\nWarn: Skipping non-file: ${file}`); return; }
                        const content = fs.readFileSync(filePath, 'utf8'); fileContents += `<file path="${escapeXml(file)}">\n${escapeXml(content)}\n</file>\n\n`;
                    } catch (readError) { fileContents += `<file path="${escapeXml(file)}" error="Could not read file: ${escapeXml(readError.message)}">\n</file>\n\n`; console.error(`\nWarn: Could not read ${file}: ${readError.message}`); }
                });
                fileContents += '</files>'; fs.writeFileSync('pack.xml', dirStructure + fileContents);
                setMode('done'); setSafeStatusMessage('pack.xml created!'); setTimeout(exit, 1500);
            } catch (error) { // Handle XML generation error
                setMode('error'); setSafeStatusMessage(`Error gen pack.xml: ${error.message}`); console.error("\nError gen pack.xml:", error); setTimeout(() => exit(error), 3000);
            }
        } else if (trimmedQuery !== '') { // Process glob
            try {
                const globOptions = { nodir: true, cwd: process.cwd(), ignore: ignorePatterns, dot: true }; const foundFiles = globSync(trimmedQuery, globOptions); const currentFileCount = collectedFiles.size; const updatedFiles = new Set([...collectedFiles, ...foundFiles]); const newFilesAdded = updatedFiles.size - currentFileCount; setCollectedFiles(updatedFiles);
                let message = `Found ${foundFiles.length}. Added ${newFilesAdded} new. Total: ${updatedFiles.size}.`; if (ignorePatterns.length > 0) message += ' (.gitignore respected)'; message += ' Enter next glob or Enter to finish. ESC for menu.';
                setSafeStatusMessage(message);
            } catch (error) { // Handle glob error
                setSafeStatusMessage(`Error glob "${trimmedQuery}": ${error.message}. Try again or ESC.`); console.error(`\nError glob "${trimmedQuery}":`, error);
            }
            setGlobQuery('');
        } else { // Empty query, no files
            setSafeStatusMessage('Enter glob pattern first, or ESC for menu.');
        }
    };

    const handlePasteSave = (contentToSave) => {
        if (isHandlingRawInput.current || saveTimerRef.current || countdownIntervalRef.current) {
             console.warn("Save called while potentially active? Forcing cleanup.");
             clearSaveTimer(); restoreInput();
        }
        const trimmedContent = String(contentToSave ?? '').trim();
        if (!trimmedContent) { setMode('menu'); setSafeStatusMessage('No content pasted.'); return; }
        try { fs.writeFileSync('paste.txt', contentToSave); setMode('menu'); setSafeStatusMessage('Saved to paste.txt'); }
        catch (error) { setMode('menu'); setSafeStatusMessage(`Error saving: ${error.message}.`); console.error("\nError saving:", error); }
     };


    // --- Render Logic ---

    // Render Log (Optional: remove or comment out for production)
    // console.log(`RENDERING - Mode: ${mode}, Countdown State: ${countdown}, Status: "${statusMessage}", ApplyStatus: "${applyInputStatus}"`);

    // Render Menu
    if (mode === 'menu') {
        const items = [ { label: 'Pack files', value: 'pack' }, { label: 'Apply edits', value: 'apply' }, { label: 'Exit', value: 'exit' }, ];
        return (
            <>
                {statusMessage && (
                    <Box paddingLeft={1} paddingRight={1} marginBottom={1}>
                        <Text color="yellow" wrap="wrap">{statusMessage}</Text>
                    </Box>
                )}
                <Box flexDirection="column" padding={1}>
                    <Text>Select action:</Text>
                    <SelectInput items={items} onSelect={handleMenuSelect} />
                </Box>
            </>
        );
    }

    // Render Glob Input
    if (mode === 'globInput') {
         const displayFiles = Array.from(collectedFiles);
         const maxFilesToShow = 10;
         const truncated = displayFiles.length > maxFilesToShow;
         const filesString = displayFiles.sort().slice(0, maxFilesToShow).join(', ') + (truncated ? `... (${collectedFiles.size - maxFilesToShow} more)` : '');
         const fileListContent = collectedFiles.size > 0
            ? <Text color="gray">{filesString}</Text>
            : <Text color="gray">(None)</Text>;

        return (
            <Box flexDirection="column" padding={1}>
                <Text wrap="wrap">{statusMessage}</Text>
                <Box marginTop={1} flexWrap="wrap">
                    <Text>Files ({collectedFiles.size}): </Text>
                    {fileListContent}
                </Box>
                 <Box borderStyle="round" paddingX={1} marginTop={1}>
                    <Text>Glob:</Text>
                    <InkTextInput
                        value={globQuery}
                        onChange={setGlobQuery}
                        onSubmit={handleGlobSubmit}
                        placeholder="(e.g., src/**/*.js)"
                        focus={true}
                    />
                 </Box>
                 <Text color="dim">Enter to add. Empty Enter=generate. ESC=menu.</Text>
             </Box>
        );
    }

    // Render Apply Input (Paste Mode)
    if (mode === 'applyInput') {
        const previewText = `...${String(pasteInputRef.current ?? '').slice(-300)}`;
        return (
            <Box padding={1} flexDirection="column" borderStyle="round" borderColor="cyan" minHeight={6}>
                <Text color="cyan" bold>--- Apply Edits: Paste Mode ---</Text>
                {/* General Status */}
                <Text wrap="wrap">{applyInputStatus}</Text>
                {/* Countdown Display (only when countdown is active) */}
                {countdown !== null && ( // <-- Condition hides/shows the box
                    <Box marginTop={1} borderColor="yellow" borderStyle="single" paddingX={1}>
                        <Text color="yellow"> Finalizing... Saving in {countdown} </Text>
                    </Box>
                )}
                {/* Preview */}
                <Box marginTop={1} flexGrow={1}>
                     <Text dimColor>{previewText}</Text>
                </Box>
                <Text color="dim">Press Enter when finished. Save triggers after 3s pause. ESC cancels.</Text>
            </Box>
        );
     }

     // Render Processing/Done/Error states
     if (mode === 'processing' || mode === 'done' || mode === 'error') {
          return (
               <Box padding={1}>
                    <Text color={mode === 'error' ? 'red' : (mode === 'done' ? 'green' : 'yellow')}>
                         {statusMessage}
                    </Text>
               </Box>
          )
     }

    // Fallback render
    // console.log(`RENDERING - Fallback for invalid mode: ${mode}`); // Optional Log
    return (<Box padding={1}><Text color="red">Error: Invalid application mode '{mode}'</Text></Box>);
};

// --- Render the Ink application ---
try {
    render(<App />);
} catch (renderError) {
    console.error("Fatal Error rendering Ink application.", renderError);
    process.exit(1);
}