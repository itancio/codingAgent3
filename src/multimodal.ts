import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import { generateChatCompletion } from "./llms/chat";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

interface MemoryItem {
    subtask: string;
    reasoning: string;
    action: ActionInfo;
    evaluation: EvaluationResponse;
  }
  
  interface ExecutionResult {
    generatedCode: string;
    executionResult: string;
  }
  
  interface ActionParameters {
    prompt: string;
  }
  
  interface ActionInfo {
    action: string;
    parameters: ActionParameters;
  }
  
  interface EvaluationResponse {
    evaluation: string;
    retry: boolean;
  }
  
  interface FinalAnswerResponse {
    finalAnswer: string;
  }

export const planner = async (diff: string) => {

    const prompt = `
    You are PR-Reviewer, a language model designed to review git pull requests.
    Your task is to analyze the provided PR diff and break it into a set of well-defined
    subtasks aimed at improving the code.
    ---
    **Your Goals**:
    1. Provide constructive feedback for the PR.
    2. Suggest actionable improvements through clear and concise subtasks.
    3. Focus on the newly added lines in the PR (lines prefixed with '+').
    ---
    **Task Actions**:
    Each subtask must specify one of the following actions:
    - **reasoning**: Explain why a specific improvement or verification is needed.
    - **generate_code**: Provide code-related suggestions or generate specific tests/implementations to enhance the PR.
    ---
    **Guidelines**:
    - Ensure your subtasks are logical, actionable, and relevant to the changes in the PR.
    - Subtasks must target improvements in:
      - Code correctness and potential bug fixes.
      - Performance optimizations.
      - Security enhancements.
      - Code readability and maintainability.
    - Avoid suggesting:
      - Changes to lines not included in the diff.
      - Adding comments, docstrings, or type hints unless absolutely necessary.
    - Return the result as a JSON list of strings, where each string is a subtask.
    ---
    Here is an example of the input string:
    '
    ## src/file1.py

    @@ -12,5 +12,5 @@ def func1():
    code line that already existed in the file...
    code line that already existed in the file....
    -code line that was removed in the PR
    +new code line added in the PR
    code line that already existed in the file...
    code line that already existed in the file...

    @@ ... @@ def func2():
    ...

    ## src/file2.py
    ...
    '
    ---
    Here is an example JSON response:
    {tasks: [
        {
            action: "reasoning",
            description: "Ensure code correctness by validating the 'transform' function in utils.py."
        },
        {
            action: "generate_code",
            description: "Implement a unit test for the 'transform' function in utils.py."
        },
    ]}
    ---
    **Instructions**:
    1. Replace \`{diff}\` with the actual PR diff provided as input.
    2. Generate subtasks in an XML structure like the example above.
    3. Ensure the subtasks are minimal, focused, and help achieve meaningful improvements to the PR.
    4. Use precise descriptions for reasoning and code generation actions.
    ---
    Think critically and ensure the subtasks align with the overall goal of improving the code quality and effectiveness of the PR.
    `;

    try {
        const response = await generateChatCompletion({
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: diff },
            ],
        });

        // Ensure response is valid
        if (!response || !response.content) {
        throw new Error("Planner response is invalid or empty.");
        }
        const content = response.content;
        const subtasks = JSON.parse(content).tasks;
        return subtasks;
    } catch (error) {
        console.error("Error in planner:", error);
        throw error;
    }
};

export const reasoner = async (
    query: string,
    subtasks: string[],
    currentTask: string,
    memory: Record<string, any>[]
  ): Promise<{ reasoning: string }> => {
    // Construct the prompt without redundant query mentions
    const prompt = `
  Given a general plans from query, you are tasked with providing reasoning for completing a specific subtask in a code review process.
  
  ---
  
  **All Subtasks to Complete the User's Query**:
  <subtasks>
  ${JSON.stringify(subtasks, null, 2)}
  </subtasks>
  
  **Short-term Memory (Results of Previous Subtasks)**:
  <memory>
  ${JSON.stringify(memory, null, 2)}
  </memory>
  
  **Current Subtask to Complete**:
  <current_subtask>
  ${currentTask}
  </current_subtask>
  
  ---
  
  ### **Instructions**:
  1. **Focus on Code Correctness**:
     - Validate whether the current subtask aligns with the user's goal and ensure it maintains or improves the correctness of the code.
     - Identify and explain any potential bugs, logical flaws, or inconsistencies.
  
  2. **Analyze Code Efficiency**:
     - Review the current subtask for computational efficiency.
     - Suggest ways to reduce time complexity, improve performance, or optimize resource utilization.
  
  3. **Contextualize with Memory**:
     - Leverage results from the short-term memory to avoid redundancy or contradictory actions.
     - Use insights from prior subtasks to inform reasoning.
  
  4. **Output Requirements**:
     - Provide reasoning in JSON format as shown below.
  
  ---
  
  ### **Output Format**:
  Example JSON response:
  {
      "reasoning": "2 sentences max on how to complete the current subtask."
  }
  `;
  
    try {
        const response = await generateChatCompletion({
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: query },
            ],
        });
  
      // Ensure response validity
      if (!response || !response.content) {
        throw new Error("Reasoner response is invalid or empty.");
      }
  
      // Parse response content as JSON
      const parsedResponse = JSON.parse(response.content);
  
      // Ensure the response contains a "reasoning" field
      if (!parsedResponse.reasoning) {
        throw new Error("Reasoner response is missing the 'reasoning' field.");
      }
  
      return parsedResponse;
    } catch (error) {
      console.error("Error in reasoner:", error);
      throw error;
    }
  };
  

  export const actioner = async (
    userQuery: string,
    subtasks: string[],
    currentSubtask: string,
    reasoning: string,
    memory: Record<string, any>[]
  ): Promise<{ action: string; parameters: { prompt: string } }> => {
    // Construct the prompt
    const prompt = `
  Given the user's query (long-term goal): '${userQuery}'
  
  The subtasks are:
  <subtasks>
  ${JSON.stringify(subtasks, null, 2)}
  </subtasks>
  
  The current subtask is:
  <current_subtask>
  ${currentSubtask}
  </current_subtask>
  
  The reasoning for this subtask is:
  <reasoning>
  ${reasoning}
  </reasoning>
  
  Determine the most appropriate action to take:
  - If the task requires a calculation or verification through code, use the 'generate_code' action.
  - If the task requires reasoning without code or calculations, use the 'reasoning' action.
  
  Consider the overall goal and previous results when determining the action.
  
  Return the result as a JSON object with 'action' and 'parameters' keys. 
  The 'parameters' key should always be a dictionary with 'prompt' as a key.
  
  Example JSON responses:
  {
      "action": "generate_code",
      "parameters": {"prompt": "Write a function to calculate the area of a circle."}
  }
  {
      "action": "reasoning",
      "parameters": {"prompt": "Explain how to complete the subtask."}
  }
  `;
  
    try {
      // Send the prompt to the LLM and specify JSON mode
      const response = await generateChatCompletion({
        messages: [
            { role: "system", content: prompt },
            { role: "user", content: userQuery },
        ],
    });
  
      // Parse the response as JSON
      const responseJson = JSON.parse(response.content);
  
      // Ensure the response contains the required fields
      if (!responseJson.action || !responseJson.parameters || !responseJson.parameters.prompt) {
        throw new Error("Invalid response format from LLM");
      }
  
      return responseJson;
    } catch (error) {
      console.error("Error in actioner:", error);
      throw error;
    }
  };


  
  export const generateAndExecuteCode = async (
    prompt: string,
    userQuery: string,
    memory: MemoryItem[]
  ): Promise<ExecutionResult> => {
    const codeGenerationPrompt = `
  Generate Python code to implement the following task: '${prompt}'
  
  Here is the overall goal of answering the user's query: '${userQuery}'
  
  Keep in mind the results of the previous subtasks, and use them to complete the current subtask.
  <memory>
  ${JSON.stringify(memory, null, 2)}
  </memory>
  
  Here are the guidelines for generating the code:
  - Return only the Python code, without any explanations or markdown formatting.
  - The code should always print or return a value.
  - Don't include any backticks or code blocks in your response. Do not include \`\`\`python or \`\`\` in your response, just give me the code.
  - Do not ever use the input() function in your code; use defined values instead.
  - Do not ever use NLP techniques in your code, such as importing nltk, spacy, or any other NLP library.
  - Don't ever define a function in your code; just generate the code to execute the subtask.
  - Don't ever provide the execution result in your response, just give me the code.
  - If your code needs to import any libraries, do it within the code itself.
  - The code should be self-contained and ready to execute on its own.
  - Prioritize explicit details over assumed patterns.
  - Avoid unnecessary complications in problem-solving.
  `;
  try {
    const response = await generateChatCompletion({
      messages: [
        { role: "system", content: codeGenerationPrompt },
        { role: "user", content: userQuery },
      ],
    });

    if (!response || !response.content) {
      throw new Error("Code generation response is invalid or empty.");
    }

    const generatedCode = response.content;
    console.log(`Generated Code: ${generatedCode}`);

    const tempFilePath = path.join(__dirname, `temp_${Date.now()}.py`);
    fs.writeFileSync(tempFilePath, generatedCode, "utf-8");

    try {
      const result = execSync(`python ${tempFilePath}`, {
        encoding: "utf-8",
        timeout: 5000,
      });

      return { generatedCode, executionResult: result.trim() };
    } catch (error: any) {
      return {
        generatedCode,
        executionResult: `Error: ${error.message}`,
      };
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  } catch (error) {
    console.error("Error in generateAndExecuteCode:", error);
    throw error;
  }
};
  
  export const executor = async (
    action: string,
    parameters: ActionParameters,
    userQuery: string,
    memory: MemoryItem[]
  ): Promise<any> => {
    if (action === "generate_code") {
      console.log(`Generating code for: ${parameters.prompt}`);
      return generateAndExecuteCode(parameters.prompt, userQuery, memory);
    } else if (action === "reasoning") {
      return parameters.prompt;
    } else {
      throw new Error(`Action '${action}' not implemented.`);
    }
  };
  
  
  export const evaluator = async (
    userQuery: string,
    subtasks: string[],
    currentSubtask: string,
    actionInfo: ActionInfo,
    executionResult: ExecutionResult,
    memory: MemoryItem[]
  ): Promise<EvaluationResponse> => {
    const prompt = `
  Given the user's query (long-term goal): '${userQuery}'
  
  The subtasks to complete to answer the user's query are:
  ${JSON.stringify(subtasks, null, 2)}
  
  The current subtask to complete is:
  ${currentSubtask}
  
  The result of the current subtask is:
  ${JSON.stringify(actionInfo, null, 2)}
  
  The execution result of the current subtask is:
  ${JSON.stringify(executionResult, null, 2)}
  
  Here is the short-term memory (result of previous subtasks):
  ${JSON.stringify(memory, null, 2)}
  
  Evaluate if the result is a reasonable answer for the current subtask and makes sense in the context of the overall query.
  
  Return a JSON object with 'evaluation' (string) and 'retry' (boolean) keys.
  
  Example JSON response:
  {
      "evaluation": "The result is a reasonable answer for the current subtask.",
      "retry": false
  }
  `;
  try {
    const response = await generateChatCompletion({
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userQuery },
      ],
    });

    if (!response || !response.content) {
      throw new Error("Evaluator response is invalid or empty.");
    }

    const parsedResponse: EvaluationResponse = JSON.parse(response.content);

    if (!parsedResponse.evaluation || parsedResponse.retry === undefined) {
      throw new Error("Evaluator response does not contain valid fields.");
    }

    return parsedResponse;
  } catch (error) {
    console.error("Error in evaluator:", error);
    throw error;
  }
};
  
export const autonomousAgent = async (
    userQuery: string
  ): Promise<MemoryItem[]> => {
    const memory: MemoryItem[] = [];
    const subtasks = await planner(userQuery);
  
    for (const subtask of subtasks) {
      let evaluation: EvaluationResponse;
  
      do {
        const reasoning = await reasoner(userQuery, subtasks, subtask, memory);
        const actionInfo = await actioner(userQuery, subtasks, subtask, reasoning.reasoning, memory);
        const executionResult = await executor(actionInfo.action, actionInfo.parameters, userQuery, memory);
  
        evaluation = await evaluator(userQuery, subtasks, subtask, actionInfo, executionResult, memory);
  
        memory.push({
          subtask,
          reasoning: reasoning.reasoning,
          action: actionInfo,
          evaluation,
        });
      } while (evaluation.retry);
    }
  
    return memory;
  };
  