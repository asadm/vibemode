// source/components/ApplyEditsUI.js
import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import PropTypes from 'prop-types';
import readline from 'readline';
import fs from 'fs'; // Need fs for writeFileSync in handlePasteSave
import { applyEdit, applyEditInFull, getModifiedFiles } from '../editor.js';
import { writeDiff } from '../writeDiff.js';
import logger from '../logger.js';

const ApplyEditsUI = ({
    mode,
    // Corrected props: Receive BOTH the function and the value
    setMode,
    setStatusMessage, // Function to update parent state
    statusMessage,    // Value from parent state (no longer duplicated in destructuring args)
    stdin,
    setRawMode,
    isRawModeSupported,
    onEscape,
}) => {
    const { exit } = useApp();

    // --- State specific to this component ---
    const [applyInputStatus, setApplyInputStatus] = useState("");
    const [countdown, setCountdown] = useState(null);
    const [fileEditStatus, setFileEditStatus] = useState({}); // { [path]: "pending"|"done"|"error" }

    // --- Refs specific to this component ---
    const pasteInputRef = useRef("");
    const isHandlingRawInput = useRef(false);
    const originalRawMode = useRef(null);
    const saveTimerRef = useRef(null);
    const countdownIntervalRef = useRef(null);

    // Make sure status messages are always strings
    const setSafeApplyInputStatus = (msg) => setApplyInputStatus(String(msg ?? ""));

    // --- Helper: Clear Timers --- (Now lives inside this component)
    const clearSaveTimer = () => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        if (countdownIntervalRef.current) {
             clearInterval(countdownIntervalRef.current);
             countdownIntervalRef.current = null;
        }
        setCountdown(null); // Update state
    };

    // --- Handler: Save Pasted Content --- (Now lives inside this component)
    const handlePasteSave = async (contentToSave) => {
        const trimmedContent = String(contentToSave ?? "").trim();
        if (!trimmedContent) {
             setMode("menu"); // Change parent mode
             setStatusMessage("Paste cancelled: No content provided."); // Set parent status
             setFileEditStatus({});
             return;
        }

        setMode("processing"); // Temporary state via parent
        setStatusMessage("Parsing pasted content to identify files...");

        try {
            const { filePaths } = await getModifiedFiles(trimmedContent);

            if (!filePaths || filePaths.length === 0) {
                setMode("menu");
                setStatusMessage("No files identified for modification in the pasted content.");
                setFileEditStatus({});
                return;
            }

            const initialStatus = filePaths.reduce((acc, fp) => { acc[fp] = "pending"; return acc; }, {});
            setFileEditStatus(initialStatus); // Update local state

            setMode("applyingEdits"); // Change parent mode to show progress UI within *this* component
            setStatusMessage(`Applying edits to ${filePaths.length} file(s)...`); // Set parent status (used by progress UI title)

            const editPromises = filePaths.map(async (filePath) => {
                try {
                    // Ensure file exists before reading
                    if (!fs.existsSync(filePath)) {
                         throw new Error(`File not found: ${filePath}`);
                    }
                    const fileContent = fs.readFileSync(filePath, "utf8");
                    const result = await applyEdit(trimmedContent, filePath, fileContent);
                    logger.info("Edits for file: ", filePath, result);
                    const errors = await writeDiff(filePath, result);

                    if (errors) {
                        logger.error(`\nError applying edit to ${filePath}:`, errors);
                        throw new Error(errors);
                        // logger.warn("Retrying with full edit due to writeDiff errors for file: ", filePath, errors);
                        // const { fileContent: modifiedFileContent } = await applyEditInFull(trimmedContent, filePath, fileContent);
                        // if (modifiedFileContent !== undefined && modifiedFileContent !== null) { // Check if content exists
                        //     fs.writeFileSync(filePath, modifiedFileContent);
                        //     logger.info(`Successfully wrote full content to ${filePath} after retry.`);
                        // } else {
                        //     throw new Error(`Full edit retry failed, received null/undefined content for ${filePath}`);
                        // }
                    }
                    setFileEditStatus(prev => ({ ...prev, [filePath]: "done" }));
                    return { filePath, success: true };
                } catch (error) {
                    logger.error(`\nError applying edit to ${filePath}:`, error);
                    setFileEditStatus(prev => ({ ...prev, [filePath]: "error" }));
                    return { filePath, success: false, error: error.message || String(error) };
                }
            });

            const results = await Promise.all(editPromises);
            const successfulEdits = results.filter(r => r.success);
            const failedEdits = results.filter(r => !r.success);

            let finalMessage = `Applied edits to ${successfulEdits.length} file(s). Check log.log for details.`;
             if (failedEdits.length > 0) {
                finalMessage += ` Failed edits for ${failedEdits.length} file(s) (see log.log and console).`;
                // Keep mode as "applyingEdits" but update message, then transition later
                setStatusMessage(finalMessage);
            } else {
                // Keep mode as "applyingEdits", update message, transition later
                 setStatusMessage(finalMessage);
            }


            // Delay before returning to menu
            setTimeout(() => {
                setMode("menu");
                // The final status message remains visible on the menu screen
                setFileEditStatus({}); // Clear local status for next run
            }, failedEdits.length > 0 ? 4000 : 2500);

        } catch (error) {
             logger.error("\nError processing pasted content for edits:", error);
             // Use parent setters for mode/status
             setMode("error"); // Use generic error display via parent
             setStatusMessage(`Error preparing edits: ${error.message}. Operation cancelled.`);
             setFileEditStatus({}); // Clear local status
             setTimeout(() => { setMode("menu"); setStatusMessage(""); }, 3000);
        }
     };

    // --- Effect for Raw Input Handling --- (Now lives inside this component)
    useEffect(() => {
        const restoreInput = () => {
             if (!isHandlingRawInput.current) return;
             clearSaveTimer(); // Use internal helper
             if (stdin) {
                 stdin.removeListener("keypress", handleKeyPress);
                 if (typeof originalRawMode.current === "boolean" && typeof setRawMode === "function") {
                     try { setRawMode(originalRawMode.current); } catch (error) { logger.error("Cleanup Error setting raw mode:", error); }
                 }
             }
             isHandlingRawInput.current = false;
             originalRawMode.current = null;
         };

         const handleKeyPress = (str, key) => {
           if (key?.name !== "return") {
             clearSaveTimer(); // Use internal helper
           }
           if (!key) { return; }
           if (key.ctrl && key.name === "c") { restoreInput(); exit(new Error("Interrupted by Ctrl+C.")); return; }
           if (key.escape) {
                clearSaveTimer();
                restoreInput(); // Clean up raw mode
                onEscape(); // Call parent's escape handler (which likely sets mode to 'menu')
                return;
           }

           const isEnter = key.name === "return";

           if (isEnter) {
               clearSaveTimer();
               pasteInputRef.current += "\n";
               setSafeApplyInputStatus(`Input pause detected. Finalizing...`);
               setCountdown(3);

               const intervalId = setInterval(() => {
                   if (countdownIntervalRef.current !== intervalId) { clearInterval(intervalId); return; }
                   setCountdown(prev => (prev !== null && prev > 1 ? prev - 1 : null));
               }, 500);
               countdownIntervalRef.current = intervalId;

               saveTimerRef.current = setTimeout(() => {
                    if (countdownIntervalRef.current === intervalId) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null; }
                    saveTimerRef.current = null;
                    setCountdown(null);
                    const contentToSave = pasteInputRef.current;
                    restoreInput(); // Clean up before potentially slow save
                    handlePasteSave(contentToSave); // Use internal handler
               }, 1500);

           } else {
                let statusUpdate = `Pasting... Len: ${pasteInputRef.current.length}.`;
                if (key.name === "backspace") {
                    if (pasteInputRef.current.length > 0) { pasteInputRef.current = pasteInputRef.current.slice(0, -1); statusUpdate += " Save cancelled."; } else { statusUpdate = `Paste buffer empty. Save cancelled.`; }
                } else if (key.name === "tab") {
                    pasteInputRef.current += "    "; statusUpdate += " Save cancelled.";
                } else if (str && !key.ctrl && !key.meta && !key.escape) {
                    pasteInputRef.current += str; statusUpdate += " Save cancelled.";
                } else {
                     statusUpdate = `Key "${key.name || str}" pressed. Save cancelled. Pasting... Len: ${pasteInputRef.current.length}.`;
                }
                setSafeApplyInputStatus(statusUpdate);
           }
       };

        // Effect Setup Logic (Only when parent sets mode to "applyInput")
        if (mode === "applyInput") {
             if (!stdin || !isRawModeSupported || typeof setRawMode !== 'function') {
                 setMode("menu"); setStatusMessage("Error: Raw mode not supported/unavailable."); return;
             }
             if (isHandlingRawInput.current) { return; }

             isHandlingRawInput.current = true;
             pasteInputRef.current = "";
             setSafeApplyInputStatus("Ready. Paste content now. Press Enter when finished.");
             // setStatusMessage(""); // Let parent handle global status
             setFileEditStatus({}); // Clear local edit status
             originalRawMode.current = stdin.isRaw;

             try {
                 setRawMode(true);
                 readline.emitKeypressEvents(stdin);
                 stdin.on("keypress", handleKeyPress);
             } catch (error) {
                 logger.error("Setup Error setting raw mode:", error);
                 restoreInput();
                 setMode("menu"); setStatusMessage("Error: Failed to set raw mode.");
                 return;
             }
        } else {
             // Cleanup if mode changes *away* from applyInput externally
             if (isHandlingRawInput.current) {
                 restoreInput();
             }
        }

        // Return cleanup function
        return restoreInput;

    }, [mode, stdin, setRawMode, isRawModeSupported, exit, setMode, setStatusMessage, onEscape]); // Dependencies


    // --- Render Logic ---

    // Render Paste Input View
    if (mode === "applyInput") {
        const previewLength = 300;
        const currentPasteContent = pasteInputRef.current ?? "";
        const previewText = currentPasteContent.length > previewLength
            ? `...${currentPasteContent.slice(-previewLength)}`
            : currentPasteContent;

        return (
            <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan" minWidth={60}>
                <Box paddingX={1} marginBottom={1}>
                    <Text color="cyan" bold>--- Apply Edits: Paste Mode ---</Text>
                </Box>
                {applyInputStatus && (
                    <Box paddingX={1} marginBottom={1}>
                        <Text wrap="wrap">{applyInputStatus}</Text>
                    </Box>
                )}
                {countdown !== null && (
                    <Box marginTop={1} marginBottom={1} marginX={1} borderColor="yellow" borderStyle="single" paddingX={1} alignSelf="flex-start">
                        <Text color="yellow"> Finalizing... Saving in {countdown} </Text>
                    </Box>
                )}
                <Box marginX={1} marginBottom={1} padding={1} borderStyle="single" borderColor="gray" minHeight={5}>
                     <Text dimColor wrap="end">{previewText || "(Paste content here...)"}</Text>
                </Box>
                <Box paddingX={1}>
                    <Text color="dim">Paste content now. Press Enter when finished. Save triggers after 1.5s pause. Any key cancels save. ESC returns to menu.</Text>
                </Box>
            </Box>
        );
     }

    // Render Applying Edits Progress View
    if (mode === "applyingEdits") {
        const statusIndicators = { pending: "⏳", done: "✅", error: "❌" };
        const sortedFilePaths = Object.keys(fileEditStatus).sort();

        return (
            <Box flexDirection="column" padding={1} borderStyle="round" borderColor="magenta" minWidth={60}>
                 {/* Use the parent's statusMessage for the overall status */}
                {statusMessage && ( // *** UNCOMMENTED ***
                    <Box paddingX={1} marginBottom={1}>
                        <Text wrap="wrap" color="magenta">{statusMessage}</Text>
                    </Box>
                )}

                <Box flexDirection="column" paddingX={1}>
                    {/* Removed static title, as parent statusMessage serves this role now */}
                    {/* <Text bold>Applying Edits:</Text> */}
                    {sortedFilePaths.length === 0 && <Text dimColor> (Identifying files...)</Text>}
                    {sortedFilePaths.map((filePath) => {
                        const status = fileEditStatus[filePath];
                        const indicator = statusIndicators[status] || "?";
                        return (
                            <Box key={filePath} marginLeft={1}>
                                <Text>
                                    {indicator}{" "}
                                    <Text color={status === "error" ? "red" : status === "done" ? "green" : undefined}> {/* Added green for done */}
                                        {filePath}
                                    </Text>
                                </Text>
                            </Box>
                        );
                    })}
                </Box>
                {/* No need to display statusMessage again at the bottom */}
            </Box>
        );
    }

    // Should not happen if parent manages mode correctly, but return null otherwise
    return null;
};

ApplyEditsUI.propTypes = {
    mode: PropTypes.string.isRequired,
    statusMessage: PropTypes.string, // Make sure parent passes it
    setMode: PropTypes.func.isRequired,
    setStatusMessage: PropTypes.func.isRequired,
    stdin: PropTypes.object,
    setRawMode: PropTypes.func,
    isRawModeSupported: PropTypes.bool,
    onEscape: PropTypes.func.isRequired,
};

export default ApplyEditsUI;