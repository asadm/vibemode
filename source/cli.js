#!/usr/bin/env node
import React, { useState, useMemo } from "react";
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
                .flatMap(l => (!l.includes("*") && !l.includes("/") && !l.startsWith("!")) ? [l, `${l}/**`] : [l]);
        } catch (error) {
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
        // Reset state relevant to the mode we are escaping FROM
        if (mode === "globInput") {
            // No specific timer to clear for globInput
        } else if (mode === "applyInput" || mode === "applyingEdits") {
            // ApplyEditsUI handles its own timer clearing via useEffect cleanup
            // We just need to ensure the mode is set back correctly.
            // Note: setRawMode(false) is handled by ApplyEditsUI's cleanup effect.
        }
        setMode("menu");
        setSafeStatusMessage(
             mode === "globInput" ? "Glob input cancelled." : "Operation cancelled."
        );
        // Clear specific state that should reset when returning to menu
        setCollectedFiles(new Set()); // Clear files if escaping from glob
        // ApplyEditsUI clears its own fileEditStatus/paste buffer etc.
    };

    useInput((input, key) => {
        if (key.escape) {
            // Only trigger escape handling if NOT in the main menu
            if (mode !== "menu" && mode !== "processing" && mode !== "done" && mode !== "error") {
                 handleGlobalEscape();
            }
        }
         // Note: Ctrl+C in raw mode is handled within ApplyEditsUI's effect
         // Ink handles Ctrl+C in non-raw modes automatically
    }, { isActive: true }); // Active in all modes for Escape


    // --- Action Handlers ---

    const handleMenuSelect = (item) => {
        // Clear any potential leftover status messages from previous operations
        setSafeStatusMessage("");
        // Clear state specific to previous modes BEFORE switching
        setCollectedFiles(new Set()); // Reset files when leaving menu for a new action

        if (item.value === "pack") {
            setMode("globInput");
            // Initial status for PackFilesUI is set internally within the component
        } else if (item.value === "apply") {
            if (!isRawModeSupported) {
                setMode("menu"); // Stay in menu
                setSafeStatusMessage("Raw mode not supported for \"Apply\".");
                return;
            }
            setMode("applyInput"); // ApplyEditsUI useEffect will handle setup
        } else if (item.value === "exit") {
            exit();
        }
    };

    // --- Render Logic ---

    switch (mode) {
        case "menu":
            return <MainMenuUI statusMessage={statusMessage} onSelect={handleMenuSelect} />;

        case "globInput":
            return (
                <PackFilesUI
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
            return (
                <ApplyEditsUI
                    mode={mode}
                    statusMessage={statusMessage}
                    setMode={setMode}
                    setStatusMessage={setSafeStatusMessage} // Pass the central setter
                    stdin={stdin}
                    setRawMode={setRawMode}
                    isRawModeSupported={isRawModeSupported}
                    onEscape={handleGlobalEscape} // Pass escape handler
                />
            );

        case "processing":
        case "done":
        case "error":
             // These modes now just show a status message managed centrally
             return <StatusDisplay mode={mode} statusMessage={statusMessage} />;

        default:
            // Fallback for any unexpected mode
             return <StatusDisplay mode="error" statusMessage={`Error: Invalid application mode "${mode}"`} />;
    }
};

// --- Render the Ink application ---
try {
    render(<App />);
} catch (renderError) {
    logger.error("Fatal Error rendering Ink application.", renderError);
    console.error("Fatal Error rendering Ink application:", renderError); // Also log to console
    process.exit(1);
}