// source/components/ApplyEditsUI.js
import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink'; // Added useInput
import readline from 'readline';
import fs from 'fs';
import { applyEdit, getModifiedFiles } from '../editor.js';
import { writeDiffToFile } from '../writeDiff.js';
import logger from '../logger.js';

const ApplyEditsUI = ({ //NOSONAR - Ignore complexity for now
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
    const [showRetryOptions, setShowRetryOptions] = useState(false); // State to control retry prompt visibility
    // Removed processingComplete state, parent controls flow

    // --- Refs ---
    const pasteInputRef = useRef("");
    const isHandlingRawInput = useRef(false);
    const originalContentRef = useRef(''); // Ref to store the original pasted content for retries
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
            // Also clear retry/save timers on unmount
            clearSaveTimer();
            if (menuTimeoutRef.current) clearTimeout(menuTimeoutRef.current);
            if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

        originalContentRef.current = trimmedContent; // Store for potential retries
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
            } //NOSONAR

            // 3. Set initial "pending" state in parent and switch mode
            const initialStatus = filePaths.reduce((acc, fp) => { acc[fp] = { status: 'pending' }; return acc; }, {});
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
                let errorResult = null; // Store error for state update
                try {
                    if (!fs.existsSync(filePath)) throw new Error(`File not found`);
                    const fileContent = fs.readFileSync(filePath, "utf8");
                    const result = await applyEdit(trimmedContent, filePath, fileContent);
                    const errors = await writeDiffToFile(filePath, result);
                    if (errors) throw new Error(errors);
                    logger.info(`Successfully applied edit to ${filePath}`);
                    currentStatus = "done";
                    return { filePath, status: currentStatus, success: true };
                } catch (error) {
                    errorResult = error.message || String(error);
                    logger.error(`Error processing file ${filePath}: ${errorResult}`);
                    currentStatus = "error";
                    return { filePath, status: currentStatus, success: false, error: errorResult };
                } finally {
                    logger.info(`Processing file END: ${filePath} with status ${currentStatus}`);
                    // Update parent state incrementally with status and potential error
                    setFileEditStatus(prev => ({ ...prev, [filePath]: {
                        status: currentStatus, ...(currentStatus === 'error' ? { error: errorResult } : {})
                    } }));
                    logger.info(`QUEUED incremental parent update for ${filePath}: ${currentStatus}`);
                }
            });

            logger.info("Waiting for Promise.all...");
            const results = await Promise.all(editPromises); // Need results to calculate final message
            logger.info(`Promise.all finished. Results count: ${results.length}`);

            // 5. Calculate final status and decide next step
            const successfulEdits = results.filter(r => r.success).length;
            const failedFiles = results.filter(r => !r.success);

            if (failedFiles.length > 0) {
                // Errors occurred: Show retry options
                const finalMessage = `Applied edits to ${successfulEdits} file(s) with ${failedFiles.length} error(s).`;
                logger.warn(`${finalMessage} - Presenting retry options.`);
                setStatusMessage(`${finalMessage} Press [R] to Retry failed, [ESC] for Main Menu.`);
                if (menuTimeoutRef.current) clearTimeout(menuTimeoutRef.current); // Clear any existing menu timeout

                // Wait a moment before enabling input to avoid race conditions
                setTimeout(() => setShowRetryOptions(true), 100);

            } else {
                // All successful: Set final message and return to menu
                const finalMessage = `Successfully applied edits to ${successfulEdits} file(s). Returning to menu...`;
                logger.info(finalMessage);
                setStatusMessage(finalMessage);

                logger.info("Setting timeout to return to menu.");
                if (menuTimeoutRef.current) clearTimeout(menuTimeoutRef.current); // Clear just in case
                menuTimeoutRef.current = setTimeout(() => {
                    logger.info("Menu timeout finished.");
                    setMode("menu"); // Parent changes mode
                    // Parent should clear fileEditStatus if desired when returning to menu
                    // e.g., inside a useEffect in parent that watches for mode === 'menu'
                    menuTimeoutRef.current = null;
                }, 2500);
            }

        } catch (error) { //NOSONAR
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

    // --- Handler: Retry Failed Edits ---
    const handleRetryFailed = async () => {
        setShowRetryOptions(false); // Hide options while retrying
        logger.info("--- Starting handleRetryFailed ---");

        const filesToRetry = Object.entries(fileEditStatus)
            .filter(([_, data]) => data?.status === 'error') // Check status property
            .map(([filePath, data]) => ({ filePath, error: data.error })); // Keep track of path and previous error if needed

        if (filesToRetry.length === 0) {
            logger.info("Retry called, but no files marked as error.");
            // Maybe return to menu or show a message? For now, show menu option again.
            setStatusMessage(`No files currently marked with errors. Press [ESC] for Main Menu.`);
            setTimeout(() => setShowRetryOptions(true), 100); // Re-show options
            return;
        }

        setStatusMessage(`Retrying ${filesToRetry.length} failed file(s)...`);

        // Mark files as 'retrying' in parent state
        const retryingStatus = filesToRetry.reduce((acc, { filePath }) => {
            acc[filePath] = { status: 'retrying' }; // Update with status object
            return acc;
        }, {});
        setFileEditStatus(prev => ({ ...prev, ...retryingStatus }));
        logger.info(`Marked files for retry: ${JSON.stringify(filesToRetry.map(f=>f.filePath))}`);

        // --- Retry Processing Logic (similar to handlePasteSave loop) ---
        const originalContent = originalContentRef.current; // Get the saved original paste
        if (!originalContent) {
            logger.error("Cannot retry: Original pasted content is missing.");
            setStatusMessage("Error: Cannot retry, original content lost. Returning to menu.");
            setMode("menu"); // Go back to menu on critical error
            return;
        }

        const retryPromises = filesToRetry.map(async ({ filePath }) => {
            logger.info(`Retrying file START: ${filePath}`);
            let currentStatus = 'retrying';
            let retryError = null; // Store error from this retry attempt
            try {
                // Read the *current* file content, as it might have been changed by other successful edits
                if (!fs.existsSync(filePath)) throw new Error(`File not found`);
                const fileContent = fs.readFileSync(filePath, "utf8");

                // Call applyEdit again with original paste content and current file content
                const result = await applyEdit(originalContent, filePath, fileContent); // Use originalContentRef.current
                const errors = await writeDiffToFile(filePath, result);
                if (errors) throw new Error(errors);

                logger.info(`Successfully applied RETRY edit to ${filePath}`);
                currentStatus = 'done';
                return { filePath, status: currentStatus, success: true };
            } catch (error) {
                retryError = error.message || String(error); // Capture the error message
                logger.error(`Error RETRYING file ${filePath}: ${retryError}`);
                currentStatus = 'error';
                return { filePath, status: currentStatus, success: false, error: retryError };
            } finally {
                logger.info(`Retrying file END: ${filePath} with status ${currentStatus}`);
                // Update parent state incrementally for the retried file
                setFileEditStatus(prev => ({ ...prev, [filePath]: {
                    status: currentStatus, ...(currentStatus === 'error' ? { error: retryError } : {})
                } }));
                logger.info(`QUEUED incremental parent update for RETRIED ${filePath}: ${currentStatus}`);
            }
        });

        logger.info("Waiting for RETRY Promise.all...");
        const retryResults = await Promise.all(retryPromises);
        logger.info(`Retry Promise.all finished. Results count: ${retryResults.length}`);

        // --- Handle Retry Results ---
        const stillFailingFiles = retryResults.filter(r => !r.success);
        const newlySuccessfulFiles = retryResults.filter(r => r.success).length;

        if (stillFailingFiles.length > 0) {
            // Failures persist: Show retry options again
            const finalMessage = `Retry finished. ${newlySuccessfulFiles} succeeded, ${stillFailingFiles.length} still failed.`;
            logger.warn(`${finalMessage} - Presenting retry options again.`);
            setStatusMessage(`${finalMessage} Press [R] to Retry again, [ESC] for Main Menu.`);
            if (menuTimeoutRef.current) clearTimeout(menuTimeoutRef.current);
             // Wait a moment before enabling input
             setTimeout(() => setShowRetryOptions(true), 100);

        } else {
            // All retries successful: Set final message and return to menu
            const finalMessage = `All ${filesToRetry.length} previously failed files successfully edited on retry! Returning to menu...`;
            logger.info(finalMessage);
            setStatusMessage(finalMessage);

            logger.info("Setting timeout to return to menu after successful retry.");
            if (menuTimeoutRef.current) clearTimeout(menuTimeoutRef.current);
            menuTimeoutRef.current = setTimeout(() => {
                logger.info("Menu timeout finished post-retry.");
                setMode("menu");
                menuTimeoutRef.current = null;
            }, 2500);
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
                let statusUpdate = `Pasting...`;
                if (key.name === "backspace") {
                    if (pasteInputRef.current.length > 0) { pasteInputRef.current = pasteInputRef.current.slice(0, -1); statusUpdate; } else { statusUpdate = `Paste buffer empty. Save cancelled.`; }
                } else if (key.name === "tab") {
                    pasteInputRef.current += "    "; statusUpdate;
                } else if (str && !key.ctrl && !key.meta && !key.escape) { // Filter out control chars etc.
                    pasteInputRef.current += str; statusUpdate;
                } else {
                    //  statusUpdate = `Key pressed. Pasting...`;
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

    // --- Effect for Retry/Escape Input ---
    useInput((input, key) => {
        if (!showRetryOptions) return; // Only process input if options are shown

        if (input === 'r' || input === 'R') {
            logger.info("Retry key (R) detected.");
            handleRetryFailed(); // Trigger the retry process
        } else if (key.escape) {
            logger.info("Escape key detected during retry prompt.");
            setShowRetryOptions(false); // Hide options immediately
            onEscape(); // Call the escape handler passed from parent (goes to menu)
        }
         // Add logging for other keys if needed for debugging
         // else { logger.debug(`Ignoring key '${input}' while retry options shown.`); }
    }, { isActive: showRetryOptions }); // Hook is active only when showRetryOptions is true


    // --- Render Logic ---
    // Reads props from parent (mode, statusMessage, fileEditStatus)
    logger.info(`--- Rendering --- Mode: ${mode}, ShowRetry: ${showRetryOptions}`);
    // Log the prop value received during this render cycle
    // console.log(`Render state: props.fileEditStatus (via console): ${JSON.stringify(fileEditStatus)}`);

    if (mode === "applyInput") {
        const previewLength = 300;
        const currentPasteContent = pasteInputRef.current ?? "";
        const previewText = currentPasteContent.length > previewLength ? `...${currentPasteContent.slice(-previewLength)}` : currentPasteContent;
        return (
            <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan" minWidth={60}>
                <Box paddingX={1} marginBottom={1}><Text color="cyan" bold>--- Apply Edits: Paste Mode ---</Text></Box>
                {applyInputStatus && <Box paddingX={1} marginBottom={1}><Text wrap="wrap">{applyInputStatus}</Text></Box>}
                {countdown !== null && <Box marginTop={1} marginBottom={1} marginX={1} borderColor="yellow" borderStyle="single" paddingX={1} alignSelf="flex-start"><Text color="yellow"> Finalizing... Applying edits in {countdown} </Text></Box>}
                <Box marginX={1} marginBottom={1} padding={1} borderStyle="single" borderColor="gray" minHeight={5}><Text dimColor wrap="end">{previewText || "(Paste content here...)"}</Text></Box>
                <Box paddingX={1}><Text color="dim">Paste content now. Press Enter to apply. ESC returns to menu.</Text></Box>
            </Box>
        );
    }

    if (mode === "applyingEdits" || mode === "processing") { // Keep rendering status while processing/applying
        const statusIndicators = { pending: "⏳", done: "✅", error: "❌", retrying: "🔄" };
        // Use the prop directly from parent
        const currentFileStatus = typeof fileEditStatus === 'object' && fileEditStatus !== null ? fileEditStatus : {};
        // Log the file status object being rendered
        // logger.info(`Render applyingEdits: fileEditStatus = ${JSON.stringify(currentFileStatus)}`);
        const filePaths = Object.keys(currentFileStatus);
        logger.info(`Render applyingEdits/processing: Displaying ${filePaths.length} files from props.fileEditStatus.`);

        // Determine border color based on overall state or final message
        let borderColor = 'magenta'; // Default for applyingEdits
        if (mode === 'processing') borderColor = 'yellow';
        if (statusMessage.includes('error(s)') || statusMessage.includes('failed')) borderColor = 'red';
        if (statusMessage.includes('Successfully applied')) borderColor = 'green';

        return (
            <Box flexDirection="column" padding={1} borderStyle="round" borderColor={borderColor} minWidth={60}>
                {statusMessage && ( // Display parent's status message
                    <Box paddingX={1} marginBottom={1}>
                        <Text wrap="wrap" color={borderColor}>{statusMessage}</Text>
                    </Box>
                )}
                <Box flexDirection="column" paddingX={1}>
                    {/* Show identifying message based on filePaths length and status message content */}
                    {filePaths.length === 0 && (mode === 'processing' || statusMessage?.includes("Applying edits")) && (
                         <Text dimColor> (Identifying files...)</Text> // Show this if parent says "Applying" or "Processing" but state is empty
                    )}
                    {/* Map over sorted file paths */}
                    {filePaths.length > 0 && filePaths.sort().map((filePath) => {
                        const statusData = currentFileStatus[filePath] || {}; // Default to empty object if missing
                        const status = statusData.status;
                        const errorMsg = status === 'error' ? statusData.error : null;
                        const indicator = statusIndicators[status] || "?"; // Default to ? if status is unexpected
                        let textColor;
                        switch (status) {
                            case "done": textColor = "green"; break;
                            case "error": textColor = "red"; break;
                            case "retrying": textColor = "yellow"; break;
                            default: textColor = undefined; // Includes 'pending'
                        }
                        // Limit error message length for display
                        const displayError = errorMsg ? ` (${errorMsg.slice(0, 70)}${errorMsg.length > 70 ? '...' : ''})` : '';
                        return (
                            <Box key={filePath} marginLeft={1}>
                                <Text>
                                    {indicator}{" "}
                                    <Text color={textColor || undefined}> {/* Ensure undefined if no specific color */}
                                        {filePath}
                                    </Text>
                                    {status === 'error' && displayError && <Text color="red">{displayError}</Text>}
                                </Text>
                            </Box>
                        );
                    })}
                </Box>
                 {/* Render Retry options directly below the file list if needed */}
                 {showRetryOptions && (
                    <Box marginTop={1} paddingX={1}>
                        <Text color='yellow'>Press [R] to Retry failed, [ESC] for Main Menu.</Text>
                    </Box>
                 )}
            </Box>
        );
    }


    // Fallback or other modes (like done/error if parent handles them separately) might render null here
    logger.info(`--- Rendering mode ${mode}, returning null (or handled by parent) ---`);
    return null; // Return null if not in a rendered mode handled above
};

export default ApplyEditsUI;