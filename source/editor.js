import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import logger from "./logger.js";

const fence = "`"

const systemPrompt = (filePath) => `Act as an expert software developer.
Always use best practices when coding.
Respect and use existing conventions, libraries, etc that are already present in the code base.

The user request has the instructions on what changes need to be done. Use the following to describe and format the change.

Describe each change with a *SEARCH/REPLACE block* per the examples below.

ALWAYS use the full path, use the files structure to find the right file path otherwise see if user request has it.

All changes to files must use this *SEARCH/REPLACE block* format.
ONLY EVER RETURN CODE IN A *SEARCH/REPLACE BLOCK*!

Some of the changes are not relevant to this current file ie. ${filePath}, SKIP THOSE IN YOUR RESPONSE.

The user request also may be in different format, MAKE SURE TO ONLY USE THE *SEARCH/REPLACE BLOCK*.

Make sure search block exists in original file and is NOT empty

Please make sure the block is formatted correctly with \`<<<<<<< SEARCH\`, \`=======\` and \`>>>>>>> REPLACE\` as shown below.

EXAMPLE:

User: Change get_factorial() to use math.factorial
Assistant:
To make this change we need to modify ${fence}${filePath}${fence} to:

1. Import the math package.
2. Remove the existing factorial() function.
3. Update get_factorial() to call math.factorial instead.

Here are the *SEARCH/REPLACE* blocks:

${fence}${fence}${fence}
<<<<<<< SEARCH
from flask import Flask
=======
import math
from flask import Flask
>>>>>>> REPLACE
${fence}${fence}${fence}

${fence}${fence}${fence}
<<<<<<< SEARCH
def factorial(n):
    "compute factorial"

    if n == 0:
        return 1
    else:
        return n * factorial(n-1)

=======
>>>>>>> REPLACE
${fence}${fence}${fence}

${fence}${fence}${fence}
<<<<<<< SEARCH
    return str(factorial(n))
=======
    return str(math.factorial(n))
>>>>>>> REPLACE
${fence}${fence}${fence}
`


const modifiedFilesPrompt = `Act as an expert software developer.
The user request has the instructions on what changes need to be done in the code. The user instruction may also have the file structure relevant to the request.

Return a list of files that need to be modified. Please always return full path.
`


const systemPromptFullEdit = (filePath) => `Act as an expert software developer.
Always use best practices when coding.
Respect and use existing conventions, libraries, etc that are already present in the code base.

The user request has the instructions on what changes need to be done. Apply the changes to the file given and return the ENTIRE modified file content back.

The user request may have changes not related to this file, SKIP THOSE IN YOUR RESPONSE.

`

function getOpenai(){
    const openai = new OpenAI({
        apiKey: process.env.GEMINI_KEY,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
    });
    return openai;
}

export async function applyEdit(content, filePath, currentFileContent, lastResponse, errorsFromLastResponse){
    const openai = getOpenai();
    const response = await openai.chat.completions.create({
        model: "gemini-2.0-flash",
        messages: [
            { role: "system", content: systemPrompt(filePath) },
            {
                role: "user",
                content: "Original file content:\n\n\`\`\`\n" + currentFileContent + "\n\`\`\`",
            },
            {
                role: "user",
                content: content,
            },
            lastResponse && {
                role: "assistant",
                content: lastResponse,
            },
            lastResponse && errorsFromLastResponse && {
                role: "user",
                content: errorsFromLastResponse + "\n\nPlease respond with all changes again correctly formatted as a *SEARCH/REPLACE block* per the examples above.",
            }
        ],
    });

    return response.choices[0].message.content;
}

export async function getModifiedFiles(userRequest){
    const ModifiedFilesList = z.object({
        filePaths: z.array(z.string()),
      });
    const openai = getOpenai();
    const response = await openai.chat.completions.create({
        model: "gemini-2.0-flash",
        messages: [
            { role: "system", content: modifiedFilesPrompt },
            {
                role: "user",
                content: userRequest,
            },
        ],
        response_format: zodResponseFormat(ModifiedFilesList),
    });

    // console.log(response.choices[0].message);
    return JSON.parse(response.choices[0].message.content);
}