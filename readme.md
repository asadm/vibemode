# vibemode

Pack your entire repository (or selected parts) into an AI-friendly format and apply AI suggested changes back with ease, all from your terminal.

`vibemode` is a terminal-based tool designed to streamline interactions with Large Language Models (LLMs) like Google Gemini for code generation and refactoring. It helps you:

1.  **Pack Context:** Package selected files from your project (respecting `.gitignore`) into a single, structured XML format, perfect for pasting into an AI chat interface.
2.  **Apply Changes:** Take the diff-like output provided by an AI (in any format it gives it back to you) and apply those changes directly back to your local files using the Gemini API.

## 🤔 Why

Sure you can use cursor or copilot but I usually resort to using the model directly from the official UI they provide, be it ChatGPT or AI Studio. 
But I also want to apply the changes back to my repo. This is the missing glue for this workflow!

## ✨ Features

*   **Interactive Packing:** Use glob patterns or type file/directory names with autocomplete to select folders and files to pack.
*   **.gitignore Aware:** Automatically respects rules in your `.gitignore` file.
*   **AI-Friendly Output:** Generates a structured XML containing the directory structure and file contents, ready for AI consumption.
*   **Clipboard Integration:** Copies the packed XML directly to your clipboard for easy pasting.
*   **Automated Patching:** Parses AI-generated responses and applies the changes to your local files.
*   **Error Handling & Retry:** Sometimes applying a patch fails partially, let's you retry failed attempts.
*   **Powered by Gemini:** Utilizes Google's Gemini 2.0 Flash model for the "Apply Edits" functionality (requires API key).

## 🚀 Usage

No installation is required! Run directly using `npx`:

```bash
npx vibemode
```

This will launch the interactive terminal interface. Follow the prompts to either "Pack files" or "Apply edits".

*   **Pack files:** Enter glob patterns or file/directory paths. Press Enter on an empty input line when done to copy the XML to your clipboard.
*   **Apply edits:** Paste the response from your AI containing the SEARCH/REPLACE blocks.

## 🔧 Applying Edits (Requires Gemini API Key)

The "Apply edits from paste" feature uses the Google Gemini API (specifically the `gemini-2.0-flash` model) to understand and apply changes described in a specific format within the pasted text.

**To use this feature, you MUST:**

1.  **Obtain a Gemini API Key:** You can get a free API key from Google AI Studio: [https://aistudio.google.com/](https://aistudio.google.com/)
2.  **Set the Environment Variable:** Before running `vibemode`, set the `GEMINI_KEY` environment variable in your terminal:

    ```bash
    # On Linux/macOS
    export GEMINI_KEY='YOUR_API_KEY_HERE'

    # On Windows (Command Prompt)
    set GEMINI_KEY=YOUR_API_KEY_HERE

    # On Windows (PowerShell)
    $env:GEMINI_KEY='YOUR_API_KEY_HERE'
    ```
3.  **Run Vibemode:**
    ```bash
    npx vibemode
    ```
4.  **Select "Apply edits"** and paste the AI-generated response containing the SEARCH/REPLACE blocks when prompted. The tool will then attempt to apply these changes to your local files.

## License

Apache License 2.0

---

*Happy Vibing!*
