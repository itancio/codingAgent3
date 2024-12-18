- app.ts

  - getChangesPerFile(payload) 2
  - handlePullRequestOpened 1

- review.ts
  applyReview
  getGitFile 3b
  getFileContents
  commentIssue
  createBranch
  -postGeneralReviewComment
  -postInlineComment
  -addLineNumbers

review-agents.ts
logPRInfo
reviewDiff
reviewFiles
dedupSuggestions
reviewChanges
generateInlineComments 3c
processPullRequest 3

    -filterFile
    -groupFilesByExtension
    -processWithinLimitFiles
    -stripRemovedLines
    -processOutsideLimitFiles
    -processXMLSuggestions                  4a1
    -generateGithubIssueUrl                 4b1
    -convertPRSuggestionToComment           4b
    -xmlResponseBuilder                     4a
    -curriedXmlResponseBuilder              4
    -basicResponseBuilder
    -indentCodeFix
    -preprocessFile                         3a
    -reviewChangesRetry

prompts.ts
REVIEW_DIFF_PROMPT
XML_PR_REVIEW_PROMPT
PR_SUGGESTION_TEMPLATE
buildSuggestionPrompt
buildPatchPrompt
getReviewPrompt
getXMLReviewPrompt 3d
constructPrompt
getTokenLength
isConversationWithinLimit

constants.ts
@ PRFILE
@ Builders
@ PatchInfo
@ PRSuggestion
@ CodeSuggestion
@ ChatMessage
@ Review
@ BranchDetails
@ EnclosingContext
@ AbstractParser
EXTENSIONS_TO_PARSERS

    sleep
    processGitFilepath
    getParserForExtension
    assignLineNumbers

PAYLOAD STRUCTURE
payload:
pull_request:
repository:
name:
owner:
login:

### Step-by-Step Call Stack: Starting from `handlePullRequestOpened` in `app.ts`

From the provided files, I'll outline the function call stack when `handlePullRequestOpened` is triggered. Since `handlePullRequestOpened` directly isn't visible, I will infer its logic from context and the main `processPullRequest` function in `app.ts`.

---

#### **1. Entry Point: `handlePullRequestOpened`**

- This function is invoked when a Pull Request (PR) is opened.
- It likely parses PR metadata (e.g., `files`, `payload`, etc.) and initiates the review process by calling `processPullRequest`.

---

#### **2. `processPullRequest` in `app.ts`**

##### Purpose:

Handles the logic for processing pull request files. This involves:

1. Preprocessing files.
2. Reviewing changes.
3. Optionally generating inline suggestions.

##### Key Steps:

1. **Filter Files**:

   ```typescript
   const filteredFiles = files.filter((file) => filterFile(file));
   ```

   Filters PR files to process only relevant ones.

2. **Preprocess Files**:

   ```typescript
   await Promise.all(
     filteredFiles.map((file) => preprocessFile(octokit, payload, file))
   );
   ```

   Calls `preprocessFile` for each filtered file to fetch its old and new contents from the repository.

3. **Review Changes**:
   Depending on `includeSuggestions`, reviews files with `reviewChangesRetry`.

4. **Return Results**:
   Returns a summary of the review and suggestions.

---

# app.ts

Here’s an explanation of what is happening in the provided code:

---

### **1. `getChangesPerFile` Function**

#### **Purpose**

This function retrieves a list of files changed in a GitHub pull request (PR) using GitHub's REST API.

#### **Key Steps**

1. **Get `Octokit` Instance**:

   - `reviewApp.getInstallationOctokit(payload.installation.id)` retrieves an authenticated Octokit client scoped to the installation of the GitHub App that triggered the webhook event.

2. **Fetch Changed Files**:

   - Calls `octokit.rest.pulls.listFiles` to list all files that were modified, added, or deleted in the pull request.
   - Parameters include:
     - `owner`: The GitHub username or organization name owning the repository.
     - `repo`: The repository name.
     - `pull_number`: The pull request number.
   - The response is destructured to extract the `data` (an array of file objects).

3. **Log Files for Debugging**:

   - `console.dir({ files }, { depth: null })` logs the details of the files to the console for inspection.

4. **Error Handling**:
   - If an error occurs (e.g., due to invalid payload or network issues), it logs `"exc"` and returns an empty array.

#### **Return Value**

- On success: Returns an array of file objects representing the files changed in the pull request.
- On failure: Returns an empty array.

---

### **2. `handlePullRequestAction` Function**

#### **Purpose**

This function processes a pull request webhook event and submits a review for the PR.

#### **Key Steps**

1. **Log the PR Event**:

   - Logs the PR number to the console for debugging purposes.

2. **Log Repository Information**:

   - Logs the repository's ID, full name, and URL to provide context about which repository and PR are being processed.

3. **Get Changed Files**:

   - Calls `getChangesPerFile` to fetch the list of files changed in the PR.

4. **Generate a Review**:

   - Calls `processPullRequest` with the following:
     - `octokit`: The authenticated Octokit client.
     - `payload`: The webhook payload containing PR and repository details.
     - `files`: The list of files changed in the PR.
     - `true`: (Assumed to indicate some additional processing option.)
   - This step generates a review for the PR, presumably analyzing the changes for feedback.

5. **Apply the Review**:

   - Calls `applyReview` to post the generated review to the pull request on GitHub.

6. **Log Success**:

   - Logs `"Review Submitted"` to indicate the review was successfully applied.

7. **Error Handling**:
   - Catches and logs any errors that occur during the processing of the PR.

---

### **Usage Flow**

1. A GitHub webhook triggers the `handlePullRequestAction` function when a PR event (e.g., `opened`, `synchronize`) occurs.
2. Inside `handlePullRequestAction`:
   - PR details are logged.
   - `getChangesPerFile` fetches the list of changed files in the PR.
   - `processPullRequest` analyzes the changes and generates a review.
   - `applyReview` submits the review to the PR on GitHub.
3. Errors during any step are caught and logged.

---

### **Example Execution**

#### **Input**

A pull request event webhook payload:

```json
{
  "installation": { "id": 123 },
  "repository": {
    "id": 456,
    "owner": { "login": "octocat" },
    "name": "hello-world",
    "full_name": "octocat/hello-world",
    "html_url": "https://github.com/octocat/hello-world"
  },
  "pull_request": {
    "number": 42
  }
}
```

#### **Execution Steps**

1. **Log Event Details**:

   ```
   Received a pull request event for #42
   PR Info: { id: 456, fullName: 'octocat/hello-world', url: 'https://github.com/octocat/hello-world' }
   ```

2. **Fetch Changed Files**:
   Logs the list of files changed in the PR.

3. **Generate and Apply Review**:

   ```
   Review Submitted
   ```

4. **Error Handling**:
   If any step fails, logs the error and continues execution.

---

#### **3. `preprocessFile` in `app.ts`**

##### Purpose:

Fetches file contents (old and current versions) for the specified PR file.

##### Steps:

1. Fetches file contents using:
   ```typescript
   getGitFile(octokit, payload, baseBranch, file.filename);
   ```
   Retrieves the file content from the base and current branches.
2. Assigns the contents to the `PRFile` object:
   ```typescript
   file.old_contents = String.raw`${oldContents.content}`;
   file.current_contents = String.raw`${currentContents.content}`;
   ```

---

#### **4. `reviewChangesRetry` in `app.ts`**

##### Purpose:

Attempts to review changes using different builders until successful.

##### Steps:

1. Loops through multiple `Builders`:

   ```typescript
   for (const { convoBuilder, responseBuilder } of builders) {
     return await reviewChanges(
       traceTag,
       files,
       convoBuilder,
       responseBuilder,
       model
     );
   }
   ```

2. Handles errors and retries with the next builder if the previous one fails.

---

#### **5. `reviewChanges` in `reviews.ts`**

##### Purpose:

Analyzes PR file changes and groups files for reviewing.

##### Steps:

1. **Filter and Tokenize Files**:
   Filters files and calculates their token lengths.

   ```typescript
   filteredFiles.map(
     (file) => (file.patchTokenLength = getTokenLength(patchBuilder(file)))
   );
   ```

2. **Group Files by Size**:
   Splits files into:

   - **Within Model Limit**: Files that can fit in the model’s token context.
   - **Exceeding Model Limit**: Files too large for a single context.

3. **Process Each Group**:
   Processes groups of files and generates feedback:
   ```typescript
   const feedbacks = await Promise.all(
     groups.map((patchGroup) =>
       reviewFiles(traceTag, patchGroup, model, patchBuilder, convoBuilder)
     )
   );
   ```

---

#### **6. `reviewFiles` in `reviews.ts`**

##### Purpose:

Performs the actual review for a group of files.

##### Steps:

1. Constructs a conversation prompt using `patchBuilder` and `convoBuilder`.
   ```typescript
   const convo = constructPrompt(files, patchBuilder, convoBuilder);
   ```
2. Sends the prompt to the AI model and processes its response.

---

#### **7. `constructPrompt` in `prompts.ts`**

##### Purpose:

Builds a prompt for reviewing a group of files.

##### Steps:

1. Maps over files to build their patches.
   ```typescript
   const patches = files.map((file) => patchBuilder(file));
   ```
2. Joins patches into a single diff.
3. Uses `convoBuilder` to generate a formatted prompt.

---

#### **8. AI Interaction (`chatFns`)**

##### Purpose:

Generates review responses using the AI model.

##### Steps:

1. Calls an AI function (e.g., `chatFns`) with the prompt.
2. Parses and returns feedback or suggestions.

---

#### **Supporting Components**

1. **`JavascriptParser` in `javascript-parser.ts`**:

   - Used to find enclosing contexts for inline comments.
   - Analyzes file contents with Babel for tokenization and context extraction.

2. **`filterFile`, `getGitFile`, `getTokenLength`**:

   - Utility functions for filtering, fetching file content, and calculating token lengths.

3. **Logging**:
   - Logs execution details (e.g., file counts, errors) for debugging.

---

### Call Stack Summary

1. **`handlePullRequestOpened`** (entry point):
   - Calls `processPullRequest`.
2. **`processPullRequest`**:
   - Filters files, preprocesses them, and reviews changes.
3. **`preprocessFile`**:
   - Fetches old and new file contents.
4. **`reviewChangesRetry`**:
   - Attempts review using multiple strategies.
5. **`reviewChanges`**:
   - Groups files and generates feedback.
6. **`reviewFiles`**:
   - Reviews grouped files using AI prompts.
7. **`constructPrompt`**:
   - Builds conversation prompts for the AI.
8. **AI Functions (`chatFns`)**:
   - Generates and returns feedback for PR files.

---

Let's break this down into the workflow and differences in **`processPullRequest`**, **`reviewFiles`**, **`reviewDiff`**, and **`generateInlineComments`**, focusing on their usage of the **`generateChatCompletion`** function.

---

### **1. `processPullRequest` Workflow**

`processPullRequest` is the high-level function responsible for orchestrating the review process for a pull request (PR). Here's how it integrates:

- **Step 1: File-level Review**:
  It uses **`reviewFiles`** to analyze the content of files in the pull request. This step typically focuses on broad aspects like structure, syntax, and style across the entire file.

- **Step 2: Diff-level Review**:
  It then calls **`reviewDiff`**, which zeroes in on changes introduced in the PR (i.e., additions, deletions, and modifications in the code). This provides a more focused review on new or updated code.

Both **`reviewFiles`** and **`reviewDiff`** internally call **`generateChatCompletion`** to interact with the AI model. The AI provides suggestions or feedback based on the prompts crafted for file-level or diff-level contexts.

---

### **2. `reviewFiles` Usage of `generateChatCompletion`**

`reviewFiles` generates a prompt that represents the entire file or a significant chunk of it. Its purpose is to evaluate the overall quality, structure, and adherence to best practices.

**Key Characteristics**:

- Scope: Operates at the **file level**, analyzing large chunks of code at once.
- Prompt: Focused on holistic questions, such as "How can this file be improved in terms of readability and maintainability?"
- AI Output: Provides broad recommendations, such as refactoring suggestions or identifying patterns like repeated code blocks.

**Example Workflow**:

1. Prepares the prompt with the full file content.
2. Calls **`generateChatCompletion`**.
3. Processes the AI response to derive file-level insights.

---

### **3. `reviewDiff` Usage of `generateChatCompletion`**

`reviewDiff` focuses specifically on the **changes** introduced in the pull request (the "diff" in version control systems). This allows for a granular review of what is new or modified.

**Key Characteristics**:

- Scope: Operates at the **diff level**, targeting only the lines that have changed in the pull request.
- Prompt: Focused on assessing the correctness, style, and potential side effects of the changes.
- AI Output: Provides detailed comments or highlights issues directly related to the new code.

**Example Workflow**:

1. Extracts the diff (e.g., using Git or API).
2. Prepares a prompt that summarizes the changes.
3. Calls **`generateChatCompletion`**.
4. Returns detailed comments for the specific changes.

---

### **4. `generateInlineComments` Usage of `generateChatCompletion`**

`generateInlineComments` is similar to `reviewDiff` in that it also focuses on the PR's changes. However, it takes the process one step further by associating AI-generated comments directly with specific lines in the code.

**Key Characteristics**:

- Scope: Line-specific comments on the diff.
- Prompt: Structured to analyze a specific code snippet or single change.
- AI Output: Concise and targeted comments that are designed to be attached inline to the reviewed code.

**Example Workflow**:

1. Iterates over the lines of code in the diff.
2. Prepares prompts for each relevant line or block.
3. Calls **`generateChatCompletion`** for each snippet.
4. Attaches the AI’s output as inline comments to the pull request.

---

### **Differences**

| Feature            | `reviewFiles`             | `reviewDiff`                  | `generateInlineComments`           |
| ------------------ | ------------------------- | ----------------------------- | ---------------------------------- |
| **Scope**          | Entire file               | Changes (diff)                | Specific lines in the diff         |
| **Focus**          | Broad, holistic review    | Granular changes              | Line-specific comments             |
| **Prompt Content** | Full file content         | Summarized changes            | Individual lines or blocks         |
| **Output**         | General suggestions       | Detailed feedback on changes  | Inline comments for specific lines |
| **Use Case**       | Overall file improvements | Assess correctness of changes | Provide actionable comments        |

---

### **Why Use All Three?**

The combination of **`reviewFiles`**, **`reviewDiff`**, and **`generateInlineComments`** ensures a comprehensive review:

- **`reviewFiles`**: Ensures the overall quality and maintainability of the files in the repository.
- **`reviewDiff`**: Ensures the changes are correct and align with coding standards.
- **`generateInlineComments`**: Provides actionable, contextual feedback to developers.

---

The difference between these **array of convoBuilder/responseBuilder pairs** lies in their distinct roles and how they handle the conversation flow and AI responses for code reviews. Let’s break it down:

---

### **Purpose of convoBuilder and responseBuilder**

1. **`convoBuilder`**:

   - Constructs the **prompt** for the AI model.
   - Determines how the input (e.g., file changes, context) is formatted and passed to the AI.

2. **`responseBuilder`**:
   - Processes the **AI model’s output**.
   - Extracts meaningful information, reformats it, and structures the final result for the application.

---

### **Differences Between the Examples**

#### **1. `getXMLReviewPrompt` with `curriedXMLResponseBuilder`**

- **`getXMLReviewPrompt` (convoBuilder)**:

  - Generates a prompt in **XML format**. This structured format provides the AI with clear tags or sections for input data (e.g., `<code>`, `<file>`, `<comments>`).
  - Useful for maintaining strict structure and parsing.

- **`curriedXMLResponseBuilder` (responseBuilder)**:
  - Processes the AI's response assuming it is returned in a corresponding **XML-like structure**.
  - Likely parses the response to extract specific sections (e.g., `<suggestion>`, `<line-comments>`).
  - **Curried** means the builder may already have some parameters preconfigured, making it reusable for multiple files or contexts.

**Example Use Case**:

- When precise structure is needed, such as ensuring comments are mapped to specific lines or files.

---

#### **2. `getReviewPrompt` with `basicResponseBuilder`**

- **`getReviewPrompt` (convoBuilder)**:

  - Constructs a simpler, **natural language prompt** for the AI. This might describe the code or changes in a conversational format (e.g., "Review the following code and suggest improvements.").
  - Focuses on clarity and adaptability rather than rigid formatting.

- **`basicResponseBuilder` (responseBuilder)**:
  - Parses the AI's response in **free-text format**, extracting relevant suggestions or comments.
  - Suitable for general-purpose reviews where strict structure is not required.

**Example Use Case**:

- When flexibility is more important than rigid structure, such as in informal code reviews or exploratory analysis.

---

### **Comparison Table**

| **Aspect**                  | **`getXMLReviewPrompt` / `curriedXMLResponseBuilder`**  | **`getReviewPrompt` / `basicResponseBuilder`** |
| --------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| **Prompt Format**           | XML (structured, tagged)                                | Natural language (free-text)                   |
| **Response Format**         | XML-like, strict structure                              | Free-text, flexible                            |
| **Use Case**                | Precise mapping (e.g., line comments, suggestions)      | General-purpose reviews                        |
| **Complexity**              | Higher (requires structured data)                       | Lower (easier to implement)                    |
| **Adaptability**            | Less adaptable to changes in prompt format              | Highly adaptable                               |
| **AI Model Interpretation** | Works better for models trained with structured prompts | Works for models with conversational abilities |

---

### **Why Use Both?**

Combining multiple convoBuilder/responseBuilder pairs allows you to:

- Leverage **structured prompts** for strict, line-by-line analysis.
- Use **free-form prompts** for broader, exploratory reviews.
- Provide redundancy or fallback mechanisms (e.g., retrying with a simpler prompt if the structured one fails).

---

### **Workflow in `reviewChangesRetry`**

The `reviewChangesRetry` function likely:

1. Iterates over the files (`filteredFiles`).
2. Tries the convoBuilder/responseBuilder pairs in sequence:
   - First attempt uses `getXMLReviewPrompt` and `curriedXMLResponseBuilder`.
   - If unsuccessful or incomplete, it retries with `getReviewPrompt` and `basicResponseBuilder`.
3. Combines the outputs into a final review report.

---

### **Example Use**

If a file is passed to `reviewChangesRetry`:

- **First Attempt**: The structured XML approach (`getXMLReviewPrompt`).
- **Fallback**: If parsing or structured analysis fails, it switches to the simpler free-text approach (`getReviewPrompt`).

This ensures robustness in generating meaningful reviews even when the AI struggles with one format.

---

### **Explanation of the Code**

This code handles **reviewing changes in a pull request (PR)** by processing files, generating suggestions, and determining if those suggestions are new or actionable. Here’s a breakdown of the main components:

---

### **1. `reviewChanges` Function**

This function orchestrates the review process for multiple files in a PR, handling tasks like token limits, grouping, and feedback generation.

#### **Flow**

1. **Filter Files**:

   - Filters out files that don’t meet certain criteria using `filterFile`.
   - Calculates token lengths for patches using `getTokenLength`.

2. **Categorize Files**:

   - Files are split into two categories:
     - **Within Model Limit**: Files that can fit within the token limits of the AI model.
     - **Outside Model Limit**: Files that exceed token limits and cannot be processed.

3. **Process Files**:

   - Files within limits are processed using `processWithinLimitFiles`.
   - Files outside limits are processed using `processOutsideLimitFiles`.
   - Both processing functions group patches for review.

4. **Generate Feedback**:

   - Uses `reviewFiles` to generate feedback for each patch group.

5. **Build Response**:
   - Combines feedbacks into a final response using `responseBuilder`.

---

### **2. `indentCodeFix` Function**

This function adjusts the indentation of suggested code fixes to match the original file’s formatting.

#### **Steps**

1. Splits the file into lines.
2. Identifies the indentation of the first line in the target range.
3. Prepends the same indentation to each line of the code suggestion.

---

### **3. `isCodeSuggestionNew` Function**

This function checks if a code suggestion is already present in the file.

#### **Steps**

1. Extracts the lines of the file corresponding to the suggestion's start and end range.
2. Compares the trimmed content of the extracted lines with the suggestion.
3. Returns `false` if they are identical, indicating the suggestion is not new.

---

### **4. `generateInlineComments` Function**

This function generates inline comments (code suggestions) using an AI model.

#### **Flow**

1. **Prompt Construction**:

   - Builds a prompt using `getInlineFixPrompt`, passing the file's contents and suggestion.

2. **AI Interaction**:

   - Sends the prompt and a list of functions (including `INLINE_FIX_FUNCTION`) to the AI model.
   - Parses the `function_call` response to extract arguments.

3. **Generate Code Fix**:

   - Indents the suggested code fix to match the file.
   - Constructs a `CodeSuggestion` object containing the file, line range, correction, and comment.

4. **Validation**:

   - Checks if the suggestion is new using `isCodeSuggestionNew`.

5. **Error Handling**:
   - Logs and returns `null` if an error occurs.

---

### **5. `preprocessFile` Function**

This function fetches the contents of a file for both the base and current branches in the PR.

#### **Flow**

1. **Fetch File Contents**:

   - Retrieves the file's content from the base branch and the current branch using `getGitFile`.

2. **Store Contents**:

   - Stores the base branch content in `file.old_contents` and the current branch content in `file.current_contents`.

3. **Null Handling**:
   - Sets the contents to `null` if the file doesn’t exist.

---

### **Core Components and Logic**

#### **Grouping and Token Limits**

- Files are grouped based on whether they fit within the model’s token limits.
- Files exceeding the limits are handled separately or skipped.

#### **Feedback Generation**

- `reviewFiles` reviews each patch group, generating actionable feedback.
- The feedback is combined into a response using `responseBuilder`.

#### **Error Handling**

- Errors are logged and surfaced to ensure the process doesn’t silently fail.

#### **AI Interaction**

- The AI is leveraged via `generateChatCompletion` to provide specific code suggestions and inline comments.

{
"action": "opened",
"number": 1,
"pull_request": {
"id": 123456789,
"node_id": "MDExOlB1bGxSZXF1ZXN0MTIzNDU2Nzg5",
"url": "https://api.github.com/repos/owner/repo/pulls/1",
"html_url": "https://github.com/owner/repo/pull/1",
"diff_url": "https://github.com/owner/repo/pull/1.diff",
"patch_url": "https://github.com/owner/repo/pull/1.patch",
"issue_url": "https://api.github.com/repos/owner/repo/issues/1",
"number": 1,
"state": "open",
"locked": false,
"title": "Update the README with new information",
"user": {
"login": "octocat",
"id": 1,
"node_id": "MDQ6VXNlcjE=",
"avatar_url": "https://github.com/images/error/octocat_happy.gif",
"gravatar_id": "",
"url": "https://api.github.com/users/octocat",
"html_url": "https://github.com/octocat",
"followers_url": "https://api.github.com/users/octocat/followers",
"following_url": "https://api.github.com/users/octocat/following{/other_user}",
"gists_url": "https://api.github.com/users/octocat/gists{/gist_id}",
"starred_url": "https://api.github.com/users/octocat/starred{/owner}{/repo}",
"subscriptions_url": "https://api.github.com/users/octocat/subscriptions",
"organizations_url": "https://api.github.com/users/octocat/orgs",
"repos_url": "https://api.github.com/users/octocat/repos",
"events_url": "https://api.github.com/users/octocat/events{/privacy}",
"received_events_url": "https://api.github.com/users/octocat/received_events",
"type": "User",
"site_admin": false
},
"body": "Please pull these awesome changes in!",
"created_at": "2019-05-15T15:20:30Z",
"updated_at": "2019-05-15T15:20:30Z",
"closed_at": null,
"merged_at": null,
"merge_commit_sha": "e5bd3914e2e596debea16f433f57875b5b90bcd6",
"assignee": null,
"assignees": [],
"requested_reviewers": [],
"requested_teams": [],
"labels": [],
"milestone": null,
"commits_url": "https://api.github.com/repos/owner/repo/pulls/1/commits",
"review_comments_url": "https://api.github.com/repos/owner/repo/pulls/1/comments",
"review_comment_url": "https://api.github.com/repos/owner/repo/pulls/comments{/number}",
"comments_url": "https://api.github.com/repos/owner/repo/issues/1/comments",
"statuses_url": "https://api.github.com/repos/owner/repo/statuses/{sha}",
"head": {
"label": "octocat:changes",
"ref": "changes",
"sha": "d474d0b9b5fc4e1d9f08a290a5342b1e2e3884f1",
"user": {
"login": "octocat",
"id": 1
},
"repo": {
"id": 1296269,
"node_id": "MDEwOlJlcG9zaXRvcnkxMjk2MjY5",
"name": "Hello-World",
"full_name": "octocat/Hello-World"
}
},
"base": {
"label": "octocat:master",
"ref": "master",
"sha": "c1a4147b2ee1a2a2de2d2b3dd99c19d7d4e637f4",
"user": {
"login": "octocat",
"id": 1
},
"repo": {
"id": 1296269,
"node_id": "MDEwOlJlcG9zaXRvcnkxMjk2MjY5",
"name": "Hello-World",
"full_name": "octocat/Hello-World"
}
}
},
"repository": {
"id": 1296269,
"node_id": "MDEwOlJlcG9zaXRvcnkxMjk2MjY5",
"name": "Hello-World",
"full_name": "octocat/Hello-World"
},
"sender": {
"login": "octocat",
"id": 1
}
}
