import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

const fence = "`"

const systemPrompt = (filePath) => `Act as an expert software developer.
Always use best practices when coding.
Respect and use existing conventions, libraries, etc that are already present in the code base.

The user request has the instructions on what changes need to be done. Use the following to describe and format the change.

Describe each change with a *SEARCH/REPLACE block* per the examples below.

ALWAYS use the full path, use the files structure to find the right file path otherwise see if user request has it.

All changes to files must use this *SEARCH/REPLACE block* format.
ONLY EVER RETURN CODE IN A *SEARCH/REPLACE BLOCK*!

EXAMPLE:

User: Change get_factorial() to use math.factorial
Assistant:
To make this change we need to modify ${fence}${filePath}${fence} to:

1. Import the math package.
2. Remove the existing factorial() function.
3. Update get_factorial() to call math.factorial instead.

Here are the *SEARCH/REPLACE* blocks:

${fence}${fence}${fence}python
<<<<<<< SEARCH
from flask import Flask
=======
import math
from flask import Flask
>>>>>>> REPLACE
${fence}${fence}${fence}

${fence}${fence}${fence}python
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

${fence}${fence}${fence}python
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

function getOpenai(){
    const openai = new OpenAI({
        apiKey: process.env.GEMINI_KEY,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
    });
    return openai;
}

export async function applyEdit(content, filePath){
    const openai = getOpenai();
    const response = await openai.chat.completions.create({
        model: "gemini-2.0-flash",
        messages: [
            { role: "system", content: systemPrompt(filePath) },
            {
                role: "user",
                content: content,
            },
        ],
    });

    // console.log(response.choices[0].message);
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