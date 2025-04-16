![logo](./logo.png)

Pack your entire repository (or selected files) into an AI-friendly format and also apply AI suggested changes back with ease, all from your terminal. 
`vibemode` is a CLI-based code companion to help when you are coding using LLM directly from ChatGPT UI, AI Studio, etc.

1.  **Pack Context:** Package selected files from your project (respecting `.gitignore`) into a single, structured XML format, perfect for pasting into an AI chat interface.
2.  **Apply Changes:** Take the diff-like output provided by an AI (in any format it gives it back to you) and apply those changes directly back to your local files using the Gemini API.

![vibemode demo GIF](./preview.gif)


## 🤔 Why

Sure, you can use Cursor or Copilot or Aider but all these tools try to save money by reducing the context instead of embedding files I included as-is. 
So I usually resort to using the model directly using the official UI they provide by copying relevant (or all) my code into the chat UI.
The model then suggests changes in chat. I then want to apply the suggested changes back to my repo. `vibemode` is the missing glue for this workflow!

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

This will launch the tool and show the following options:

*   **Pack files:** Let's you pick file/directory to pack. Press Enter when done to copy the "packed" XML to your clipboard, which you paste into your favorite LLM UI.
*   **Apply edits:** Paste the response from your model, which `vibemode` parses using a smaller model and applies to the file.

## 🔧 Applying Edits (Requires Gemini API Key)

The "Apply edits from paste" feature currently uses the Google Gemini API (specifically the `gemini-2.0-flash` model) to understand and apply changes described in a specific format within the pasted text.

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
