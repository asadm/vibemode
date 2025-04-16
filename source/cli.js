#!/usr/bin/env node
import React, { useState, useMemo, useEffect } from "react"; // Added useEffect
import { render, useInput, useApp, useStdin } from "ink";
import fs from "fs";
import path from "path";
import logger from "./logger.js";

// Import UI Components
import MainMenuUI from "./components/MainMenuUI.js";
import PackFilesUI from "./components/PackFilesUI.js";
import ApplyEditsUI from "./components/ApplyEditsUI.js";
import StatusDisplay from "./components/StatusDisplay.js";

// Define initial state mode

const App = () => {
    // --- Core State ---
    const [mode, setMode] = useState("menu");
    const [statusMessage, setStatusMessage] = useState(""); // Shared status line

    // --- State related to Pack ---
    const [collectedFiles, setCollectedFiles] = useState(new Set());

    // --- State related to Apply (LIFTED STATE) ---
    const [fileEditStatus, setFileEditStatus] = useState({}); // Holds { [path]: "pending"|"done"|"error" }

    // --- Hooks ---
    const { exit } = useApp();
    const { stdin, setRawMode, isRawModeSupported } = useStdin(); // Pass these down to ApplyEditsUI

    // --- Memos ---
    const ignorePatterns = useMemo(() => {
        try {
            const gitignorePath = path.join(process.cwd(), ".gitignore");
            if (!fs.existsSync(gitignorePath)) return [];
            const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
            return gitignoreContent
                .split(/\r?\n/)
                .map(l => l.trim())
                .filter(l => l && !l.startsWith("#"))
                // Basic glob handling: if no wildcard/slash, assume file/dir and add/**
                .flatMap(l => (!l.includes("*") && !l.includes("/") && !l.startsWith("!")) ? [l, `${l}/**`] : [l]);
        } catch (error) {
            // Only log error if it's not just 'file not found'
            if (error.code !== "ENOENT") {
                logger.error("Warning: Could not read/parse .gitignore:", error.message);
            }
            return [];
        }
    }, []);

    // --- Helper: Set Safe Status ---
    const setSafeStatusMessage = (msg) => setStatusMessage(String(msg ?? ""));

    // --- Global Input Handler (Primarily for Escape) ---
    const handleGlobalEscape = () => {
        logger.info(`Handling global escape from mode: ${mode}`);
        const originalMode = mode; // Store mode before changing

        // Reset state relevant to the mode we are escaping FROM
        setMode("menu"); // Always return to menu on escape
        setSafeStatusMessage(
            originalMode === "globInput" ? "Glob input cancelled." : "Operation cancelled."
        );
        // ApplyEditsUI handles raw mode cleanup via its own effect

        // Clear specific state that should reset when returning to menu
        setCollectedFiles(new Set()); // Clear files if escaping from glob
        setFileEditStatus({}); // Clear apply edits status on escape
        logger.info(`Cleared collectedFiles and fileEditStatus due to escape.`);
    };

    useInput((input, key) => {
        if (key.escape) {
            // Only trigger escape handling if NOT in the main menu or already processing/done/error
            if (mode !== "menu" && mode !== "processing" && mode !== "done" && mode !== "error") {
                 handleGlobalEscape();
            }
        }
         // Note: Ctrl+C in raw mode is handled within ApplyEditsUI's effect
         // Ink handles Ctrl+C in non-raw modes automatically
    }, { isActive: true }); // Active in all modes for Escape


    // --- Effect to Clear fileEditStatus when returning to Menu ---
    // This ensures state is clean for the next operation
    useEffect(() => {
        if (mode === 'menu' && Object.keys(fileEditStatus).length > 0) {
            logger.info("Mode changed to 'menu', clearing fileEditStatus.");
            setFileEditStatus({});
        }
        // Log state changes for debugging purposes
        logger.info(`Mode changed to: ${mode}`);
        // Use console log for fileEditStatus because previous issues showed discrepancies
        // console.log(`Parent State Check: fileEditStatus = ${JSON.stringify(fileEditStatus)}`);

    }, [mode]); // Rerun this effect whenever the mode changes


    // --- Action Handlers ---

    const handleMenuSelect = (item) => {
        // Clear any potential leftover status messages from previous operations
        setSafeStatusMessage("");
        // Clear state specific to previous modes BEFORE switching
        setCollectedFiles(new Set()); // Reset files when leaving menu for a new action
        setFileEditStatus({});     // Reset apply status when leaving menu for a new action

        logger.info(`Menu selected: ${item.value}`);

        if (item.value === "pack") {
            setMode("globInput");
            // Initial status for PackFilesUI is set internally within the component
        } else if (item.value === "apply") {
            if (!isRawModeSupported) {
                setMode("menu"); // Stay in menu
                setSafeStatusMessage("Raw mode not supported for \"Apply\".");
                logger.warn("Apply selected, but raw mode not supported.");
                return;
            }
            // fileEditStatus is already cleared above
            setMode("applyInput"); // ApplyEditsUI useEffect will handle setup
        } else if (item.value === "exit") {
            process.exit(0);
            // exit();
        }
    };

    // --- Render Logic ---

    switch (mode) {
        case "menu":
            return <MainMenuUI statusMessage={statusMessage} onSelect={handleMenuSelect} />;

        case "globInput":
            return (
                <PackFilesUI
                    // Pass necessary props
                    collectedFiles={collectedFiles}
                    setCollectedFiles={setCollectedFiles}
                    setMode={setMode}
                    setStatusMessage={setSafeStatusMessage} // Pass the central setter
                    ignorePatterns={ignorePatterns}
                    onEscape={handleGlobalEscape} // Pass escape handler
                />
            );

        case "applyInput":
        case "applyingEdits": // ApplyEditsUI handles both internal views
        case "processing": // Keep ApplyEditsUI mounted during processing to show status eventually
            return (
                <ApplyEditsUI
                    mode={mode} // Pass current mode
                    statusMessage={statusMessage} // Pass current status message
                    setMode={setMode} // Allow child to change mode
                    setStatusMessage={setSafeStatusMessage} // Allow child to set status
                    stdin={stdin} // Pass stdin for raw mode
                    setRawMode={setRawMode} // Pass setter for raw mode
                    isRawModeSupported={isRawModeSupported} // Pass support flag
                    onEscape={handleGlobalEscape} // Pass escape handler
                    // *** Pass Lifted State and Setter ***
                    fileEditStatus={fileEditStatus}
                    setFileEditStatus={setFileEditStatus}
                />
            );

        // Simplistic display for final states or generic errors
        case "done":
        case "error":
             // These modes now just show a status message managed centrally
             // Can optionally pass fileEditStatus if needed for display here too
             return <StatusDisplay mode={mode} statusMessage={statusMessage} />;

        default:
            // Fallback for any unexpected mode
             logger.error(`Invalid application mode encountered: "${mode}"`);
             return <StatusDisplay mode="error" statusMessage={`Error: Invalid application mode "${mode}"`} />;
    }
};

// --- Render the Ink application ---
try {
    // Setup logger before first render attempt if possible
    // logger.info("--- Application Starting ---");
    render(<App />);
} catch (renderError) {
    // Log error using logger and console
    logger.error("Fatal Error rendering Ink application.", { error: renderError.message, stack: renderError.stack });
    console.error("Fatal Error rendering Ink application:", renderError);
    process.exit(1); // Exit with error code
}