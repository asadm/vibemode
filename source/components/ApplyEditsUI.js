// source/components/ApplyEditsUI.js
import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import readline from 'readline';
import fs from 'fs';
import { applyEdit, applyEditInFull, getModifiedFiles } from '../editor.js';
import { writeDiff } from '../writeDiff.js';
import logger from '../logger.js';

const ApplyEditsUI = ({
    mode,
    setMode,
    setStatusMessage,
    statusMessage = "", // Provide default directly
    stdin,
    setRawMode,
    isRawModeSupported,
    onEscape,
    // *** PROPS for Lifted State ***
    fileEditStatus = {}, // Provide default directly
    setFileEditStatus,   // Setter is required
}) => {
    const { exit } = useApp();

    // --- Local State --- (Only for UI elements within this component's lifecycle)
    const [applyInputStatus, setApplyInputStatus] = useState("");
    const [countdown, setCountdown] = useState(null);
    // Removed processingComplete state, parent controls flow

    // --- Refs ---
    const pasteInputRef = useRef("");
    const isHandlingRawInput = useRef(false);
    const originalRawMode = useRef(null);
    const saveTimerRef = useRef(null);
    const countdownIntervalRef = useRef(null);
    const menuTimeoutRef = useRef(null); // Keep for menu transition

    // Log Mount/Unmount
    useEffect(() => {
        logger.info("ApplyEditsUI MOUNTED.");
        return () => {
            logger.info("ApplyEditsUI UNMOUNTING.");
            // Clear any pending timeout on unmount
            if (menuTimeoutRef.current) {
                clearTimeout(menuTimeoutRef.current);
                menuTimeoutRef.current = null;
                logger.info("Cleared menu timeout on unmount.");
            }
        };
    }, []); // Empty dependency array runs only on mount and unmount


    const setSafeApplyInputStatus = (msg) => setApplyInputStatus(String(msg ?? ""));

    const clearSaveTimer = () => {
        if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
        if (countdownIntervalRef.current) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null; }
        setCountdown(null);
    };

    // --- Handler: Save Pasted Content ---
    // This function now focuses on the async work and calling parent setters
    const handlePasteSave = async (contentToSave) => {
        if (menuTimeoutRef.current) {
            clearTimeout(menuTimeoutRef.current);
            menuTimeoutRef.current = null;
            logger.info("Cleared previous menu timeout.");
        }
        logger.info("--- Starting handlePasteSave ---");

        const trimmedContent = String(contentToSave ?? "").trim();
        if (!trimmedContent) {
             setMode("menu");
             setStatusMessage("Paste cancelled: No content provided.");
             setFileEditStatus({}); // Clear parent state
             return;
        }

        // 1. Indicate processing started
        setMode("processing");
        setStatusMessage("Parsing pasted content to identify files...");
        setFileEditStatus({}); // Clear parent state at the beginning
        logger.info("Mode set to processing, cleared parent fileEditStatus state.");

        try {
            // 2. Identify files
            const { filePaths } = await getModifiedFiles(trimmedContent);
            logger.info(`Identified file paths: ${JSON.stringify(filePaths)}`);

            if (!filePaths || filePaths.length === 0) {
                // Give user feedback before switching mode
                setStatusMessage("No files identified for modification in the pasted content.");
                logger.info("No file paths identified, returning to menu shortly.");
                 // Wait a moment before going back to menu
                menuTimeoutRef.current = setTimeout(() => {
                    setMode("menu");
                    menuTimeoutRef.current = null;
                }, 1500);
                return;
            }

            // 3. Set initial "pending" state in parent and switch mode
            const initialStatus = filePaths.reduce((acc, fp) => { acc[fp] = "pending"; return acc; }, {});
            logger.info(`Setting initial pending status in parent: ${JSON.stringify(initialStatus)}`);
            setFileEditStatus(initialStatus); // Update parent state FIRST

            // Wrap mode/status change in setTimeout(0) to potentially help React batching/rendering
            setTimeout(() => {
                setMode("applyingEdits"); // THEN switch mode
                setStatusMessage(`Applying edits to ${filePaths.length} file(s)...`);
                logger.info(`Mode set to applyingEdits via setTimeout(0).`);
            }, 0);


            // 4. Process files (no internal state updates)
            const editPromises = filePaths.map(async (filePath) => {
                logger.info(`Processing file START: ${filePath}`);
                let currentStatus = "pending"; // Should display as pending from initialStatus
                try {
                    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
                    const fileContent = fs.readFileSync(filePath, "utf8");
                    const result = await applyEdit(trimmedContent, filePath, fileContent);
                    const errors = await writeDiff(filePath, result);
                    if (errors) throw new Error(errors);
                    logger.info(`Successfully applied edit to ${filePath}`);
                    currentStatus = "done";
                    return { filePath, status: currentStatus, success: true };
                } catch (error) {
                    logger.error(`Error processing file ${filePath}: ${error.message || String(error)}`);
                    currentStatus = "error";
                    return { filePath, status: currentStatus, success: false, error: error.message || String(error) };
                } finally {
                    logger.info(`Processing file END: ${filePath} with status ${currentStatus}`);
                    // ** Add incremental update back here - crucial for live updates **
                    // If this causes issues again, the parent's update/render cycle is the problem
                    setFileEditStatus(prev => ({ ...prev, [filePath]: currentStatus }));
                    logger.info(`QUEUED incremental parent update for ${filePath}: ${currentStatus}`);
                }
            });

            logger.info("Waiting for Promise.all...");
            const results = await Promise.all(editPromises); // Need results to calculate final message
            logger.info(`Promise.all finished. Results count: ${results.length}`);

            // 5. Calculate and set final status message in parent
            // No need to set final state again if incremental updates are used and work
            const successfulEdits = results.filter(r => r.success).length;
            const failedEdits = results.filter(r => !r.success).length;
            let finalMessage = `Applied edits to ${successfulEdits} file(s). Check log.log for details.`;
            if (failedEdits > 0) {
                finalMessage += ` Failed edits for ${failedEdits} file(s) (see log.log and console).`;
            }
            logger.info(`Setting final status message in parent: ${finalMessage}`);
            setStatusMessage(finalMessage); // Set final message


            // 6. Set timeout to return to menu (parent handles mode change)
            logger.info("Setting timeout to return to menu.");
            if (menuTimeoutRef.current) clearTimeout(menuTimeoutRef.current); // Clear just in case
            menuTimeoutRef.current = setTimeout(() => {
                logger.info("Menu timeout finished.");
                setMode("menu"); // Parent changes mode
                // Parent should clear fileEditStatus if desired when returning to menu
                // e.g., inside a useEffect in parent that watches for mode === 'menu'
                menuTimeoutRef.current = null;
            }, failedEdits > 0 ? 4000 : 2500);


        } catch (error) {
            logger.error(`Error during edit preparation/processing: ${error}`);
            setMode("error"); // Let parent handle error display
            setStatusMessage(`Error preparing edits: ${error.message}. Operation cancelled.`);
            setFileEditStatus({}); // Reset parent state on error
            if (menuTimeoutRef.current) clearTimeout(menuTimeoutRef.current);
            menuTimeoutRef.current = setTimeout(() => {
                 setMode("menu");
                 setStatusMessage("");
                 menuTimeoutRef.current = null;
                }, 3000);
        }
    };

    // --- Effect for Raw Input Handling ---
    // Manages local refs and raw mode settings
    useEffect(() => {
        const restoreInput = () => {
             if (!isHandlingRawInput.current) return;
             logger.info("Raw Input: Restoring input settings.");
             clearSaveTimer();
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
           if (key?.name !== "return") { clearSaveTimer(); }
           if (!key) { return; }
           if (key.ctrl && key.name === "c") { logger.warn("Ctrl+C detected, exiting."); restoreInput(); exit(new Error("Interrupted by Ctrl+C.")); return; }
           if (key.escape) { logger.info("Escape key detected."); clearSaveTimer(); restoreInput(); onEscape(); return; }
           if (key.name === "return") {
               logger.info("Enter key detected.");
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
                    logger.info("Save timeout finished, calling handlePasteSave.");
                    if (countdownIntervalRef.current === intervalId) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null; }
                    saveTimerRef.current = null;
                    setCountdown(null);
                    const contentToSave = pasteInputRef.current;
                    restoreInput(); // Restore *before* calling async handler
                    handlePasteSave(contentToSave); // Call the main handler
               }, 1500);
           } else {
                let statusUpdate = `Pasting... Len: ${pasteInputRef.current.length}.`;
                if (key.name === "backspace") {
                    if (pasteInputRef.current.length > 0) { pasteInputRef.current = pasteInputRef.current.slice(0, -1); statusUpdate += " Save cancelled."; } else { statusUpdate = `Paste buffer empty. Save cancelled.`; }
                } else if (key.name === "tab") {
                    pasteInputRef.current += "    "; statusUpdate += " Save cancelled.";
                } else if (str && !key.ctrl && !key.meta && !key.escape) { // Filter out control chars etc.
                    pasteInputRef.current += str; statusUpdate += " Save cancelled.";
                } else {
                     statusUpdate = `Key pressed. Save cancelled. Pasting... Len: ${pasteInputRef.current.length}.`;
                }
                setSafeApplyInputStatus(statusUpdate);
           }
       };

        if (mode === "applyInput") {
             if (!stdin || !isRawModeSupported || typeof setRawMode !== 'function') {
                 logger.error("Raw input prerequisites not met.");
                 setMode("menu"); setStatusMessage("Error: Raw mode not supported/unavailable."); return;
             }
             if (isHandlingRawInput.current) {
                 logger.warn("Raw input effect ran for applyInput, but already handling raw input.");
                 return;
             }
             logger.info("Raw Input Effect: Setting up for applyInput mode.");
             isHandlingRawInput.current = true;
             pasteInputRef.current = "";
             setSafeApplyInputStatus("Ready. Paste content now. Press Enter when finished.");
             // Parent ensures fileEditStatus is cleared
             originalRawMode.current = stdin.isRaw;
             try {
                 setRawMode(true);
                 readline.emitKeypressEvents(stdin);
                 stdin.on("keypress", handleKeyPress);
                 logger.info("Raw Input setup complete.");
             } catch (error) {
                 logger.error("Setup Error setting raw mode:", error);
                 restoreInput();
                 setMode("menu"); setStatusMessage("Error: Failed to set raw mode.");
                 return;
             }
        } else {
            // Cleanup if mode changes away from applyInput *or* if component unmounts while in raw mode
            if (isHandlingRawInput.current) {
                 logger.info(`Raw Input Effect: Cleaning up (mode is ${mode}, not applyInput).`);
                 restoreInput();
            }
        }
        // Cleanup function for this effect
        return () => {
            logger.info("Raw Input Effect CLEANUP function running.");
            // Ensure raw mode is restored if component unmounts unexpectedly
            if (isHandlingRawInput.current) {
                logger.info("Raw Input Effect CLEANUP: Still handling raw input, restoring.");
                restoreInput();
            }
        };
    // Include all dependencies used within the effect or its setup/cleanup
    }, [mode, stdin, setRawMode, isRawModeSupported, exit, setMode, setStatusMessage, onEscape]);


    // --- Render Logic ---
    // Reads props from parent (mode, statusMessage, fileEditStatus)
    logger.info(`--- Rendering --- Mode: ${mode}`);
    // Log the prop value received during this render cycle
    console.log(`Render state: props.fileEditStatus (via console): ${JSON.stringify(fileEditStatus)}`);

    if (mode === "applyInput") {
        const previewLength = 300;
        const currentPasteContent = pasteInputRef.current ?? "";
        const previewText = currentPasteContent.length > previewLength ? `...${currentPasteContent.slice(-previewLength)}` : currentPasteContent;
        return (
            <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan" minWidth={60}>
                <Box paddingX={1} marginBottom={1}><Text color="cyan" bold>--- Apply Edits: Paste Mode ---</Text></Box>
                {applyInputStatus && <Box paddingX={1} marginBottom={1}><Text wrap="wrap">{applyInputStatus}</Text></Box>}
                {countdown !== null && <Box marginTop={1} marginBottom={1} marginX={1} borderColor="yellow" borderStyle="single" paddingX={1} alignSelf="flex-start"><Text color="yellow"> Finalizing... Saving in {countdown} </Text></Box>}
                <Box marginX={1} marginBottom={1} padding={1} borderStyle="single" borderColor="gray" minHeight={5}><Text dimColor wrap="end">{previewText || "(Paste content here...)"}</Text></Box>
                <Box paddingX={1}><Text color="dim">Paste content now. Press Enter when finished. Save triggers after 1.5s pause. Any key cancels save. ESC returns to menu.</Text></Box>
            </Box>
        );
    }

    if (mode === "applyingEdits") {
        const statusIndicators = { pending: "⏳", done: "✅", error: "❌" };
        // Use the prop directly from parent
        const currentFileStatus = typeof fileEditStatus === 'object' && fileEditStatus !== null ? fileEditStatus : {};
        const filePaths = Object.keys(currentFileStatus);
        logger.info(`Render applyingEdits: Displaying ${filePaths.length} files from props.fileEditStatus.`);

        return (
            <Box flexDirection="column" padding={1} borderStyle="round" borderColor="magenta" minWidth={60}>
                {statusMessage && ( // Display parent's status message
                    <Box paddingX={1} marginBottom={1}>
                        <Text wrap="wrap" color="magenta">{statusMessage}</Text>
                    </Box>
                )}
                <Box flexDirection="column" paddingX={1}>
                    {/* Show identifying message based on filePaths length and status message content */}
                    {filePaths.length === 0 && statusMessage?.includes("Applying edits") && (
                         <Text dimColor> (Identifying files...)</Text> // Show this if parent says "Applying" but state is empty
                    )}
                    {/* Map over sorted file paths */}
                    {filePaths.length > 0 && filePaths.sort().map((filePath) => {
                        const status = currentFileStatus[filePath];
                        const indicator = statusIndicators[status] || "?"; // Default to ? if status is unexpected
                        let textColor;
                        switch (status) {
                            case "done": textColor = "green"; break;
                            case "error": textColor = "red"; break;
                            default: textColor = undefined; // Includes 'pending'
                        }
                        return (
                            <Box key={filePath} marginLeft={1}>
                                <Text>
                                    {indicator}{" "}
                                    <Text color={textColor}>
                                        {filePath}
                                    </Text>
                                </Text>
                            </Box>
                        );
                    })}
                </Box>
            </Box>
        );
    }

    logger.info(`--- Rendering mode ${mode}, returning null ---`);
    return null; // Return null if not in a rendered mode
};

export default ApplyEditsUI;