import { Octokit } from "@octokit/rest";
import { WebhookEventMap } from "@octokit/webhooks-definitions/schema";
import { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import * as xml2js from "xml2js";
import {
  getParserForExtension,
  type BranchDetails,
  type BuilderResponse,
  type Builders,
  type CodeSuggestion,
  type PRFile,
  type PRSuggestion,
} from "./constants";
import { PRSuggestionImpl } from "./data/PRSuggestionImpl";
import { generateChatCompletion } from "./llms/chat";
import {
  PR_SUGGESTION_TEMPLATE,
  buildPatchPrompt,
  constructPrompt,
  getReviewPrompt,
  getTokenLength,
  getXMLReviewPrompt,
  isConversationWithinLimit,
} from "./prompts";
import {
  INLINE_FIX_FUNCTION,
  getInlineFixPrompt,
} from "./prompts/inline-prompt";
import { getGitFile } from "./reviews";
import { autonomousAgent } from "./multimodal";
import { smarterContextPatchStrategy } from "./context/review";

export const reviewDiff = async (messages: ChatCompletionMessageParam[]) => {
  const message = await generateChatCompletion({
    messages,
  });
  const content = message.content;
  console.log("In review-agent.ts/reviewDiff - content: ", content);
  return content;
};

export const reviewFiles = async (
  files: PRFile[],
  patchBuilder: (file: PRFile) => string,
  convoBuilder: (diff: string) => ChatCompletionMessageParam[]
) => {
  const patches = files.map((file) => patchBuilder(file));
  const messages = convoBuilder(patches.join("\n"));
  console.log(
    "In review-agent.ts/reviewFiles - messages convoBuilder: ",
    messages[0].content.slice(0, 50) + "..."
  );
  const feedback = await reviewDiff(messages);
  // console.log(
  //   "In review-agent.ts/reviewFiles - feedback reviewDiff: ",
  //   feedback
  // );
  return feedback;
};

const filterFile = (file: PRFile) => {
  const extensionsToIgnore = new Set<string>([
    "pdf",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "mp4",
    "mp3",
    "md",
    "json",
    "env",
    "toml",
    "svg",
  ]);
  const filesToIgnore = new Set<string>([
    "package-lock.json",
    "yarn.lock",
    ".gitignore",
    "package.json",
    "tsconfig.json",
    "poetry.lock",
    "readme.md",
  ]);
  const filename = file.filename.toLowerCase().split("/").pop();
  if (filename && filesToIgnore.has(filename)) {
    return false;
  }
  const splitFilename = file.filename.toLowerCase().split(".");
  if (splitFilename.length <= 1) {
    return false; // return false if there is no extension
  }
  const extension = splitFilename.pop()?.toLowerCase();
  if (extension && extensionsToIgnore.has(extension)) {
    return false;
  }
  return true;
};

const groupFilesByExtension = (files: PRFile[]): Map<string, PRFile[]> => {
  const filesByExtension: Map<string, PRFile[]> = new Map();

  files.forEach((file) => {
    const extension = file.filename.split(".").pop()?.toLowerCase();
    if (extension) {
      if (!filesByExtension.has(extension)) {
        filesByExtension.set(extension, []);
      }
      filesByExtension.get(extension)?.push(file);
    }
  });

  return filesByExtension;
};

// all of the files here can be processed with the prompt at minimum
const processWithinLimitFiles = (
  files: PRFile[],
  patchBuilder: (file: PRFile) => string,
  convoBuilder: (diff: string) => ChatCompletionMessageParam[]
) => {
  const processGroups: PRFile[][] = [];
  const convoWithinModelLimit = isConversationWithinLimit(
    constructPrompt(files, patchBuilder, convoBuilder)
  );

  console.log(`Within model token limits: ${convoWithinModelLimit}`);
  if (!convoWithinModelLimit) {
    const grouped = groupFilesByExtension(files);
    for (const [extension, filesForExt] of grouped.entries()) {
      const extGroupWithinModelLimit = isConversationWithinLimit(
        constructPrompt(filesForExt, patchBuilder, convoBuilder)
      );
      if (extGroupWithinModelLimit) {
        processGroups.push(filesForExt);
      } else {
        // extension group exceeds model limit
        console.log(
          "Processing files per extension that exceed model limit ..."
        );
        let currentGroup: PRFile[] = [];
        filesForExt.sort((a, b) => a.patchTokenLength - b.patchTokenLength);
        filesForExt.forEach((file) => {
          const isPotentialGroupWithinLimit = isConversationWithinLimit(
            constructPrompt([...currentGroup, file], patchBuilder, convoBuilder)
          );
          if (isPotentialGroupWithinLimit) {
            currentGroup.push(file);
          } else {
            processGroups.push(currentGroup);
            currentGroup = [file];
          }
        });
        if (currentGroup.length > 0) {
          processGroups.push(currentGroup);
        }
      }
    }
  } else {
    processGroups.push(files);
  }
  return processGroups;
};

const stripRemovedLines = (originalFile: PRFile) => {
  // remove lines starting with a '-'
  const originalPatch = String.raw`${originalFile.patch}`;
  const strippedPatch = originalPatch
    .split("\n")
    .filter((line) => !line.startsWith("-"))
    .join("\n");
  return { ...originalFile, patch: strippedPatch };
};

const processOutsideLimitFiles = (
  files: PRFile[],
  patchBuilder: (file: PRFile) => string,
  convoBuilder: (diff: string) => ChatCompletionMessageParam[]
) => {
  const processGroups: PRFile[][] = [];
  if (files.length == 0) {
    return processGroups;
  }
  files = files.map((file) => stripRemovedLines(file));
  const convoWithinModelLimit = isConversationWithinLimit(
    constructPrompt(files, patchBuilder, convoBuilder)
  );
  if (convoWithinModelLimit) {
    processGroups.push(files);
  } else {
    const exceedingLimits: PRFile[] = [];
    const withinLimits: PRFile[] = [];
    files.forEach((file) => {
      const isFileConvoWithinLimits = isConversationWithinLimit(
        constructPrompt([file], patchBuilder, convoBuilder)
      );
      if (isFileConvoWithinLimits) {
        withinLimits.push(file);
      } else {
        exceedingLimits.push(file);
      }
    });
    const withinLimitsGroup = processWithinLimitFiles(
      withinLimits,
      patchBuilder,
      convoBuilder
    );
    withinLimitsGroup.forEach((group) => {
      processGroups.push(group);
    });
    if (exceedingLimits.length > 0) {
      exceedingLimits.forEach((file) => {
        const chunks = chunkFileByLimit(file, patchBuilder, convoBuilder);
        chunks.forEach((chunk) => processGroups.push([chunk]));
      });
    }
  }
  return processGroups;
};

/**
 * Helper function to chunk a file's patch into smaller pieces that fit within the model's token limit.
 * Each chunk preserves its location and logical boundaries (e.g., complete functions or classes).
 */
const chunkFileByLimit = (
  file: PRFile,
  patchBuilder: (file: PRFile) => string,
  convoBuilder: (diff: string) => ChatCompletionMessageParam[]
): PRFile[] => {
  const parser = getParserForExtension(file.filename);
  if (!parser) {
    throw new Error(`No parser available for file: ${file.filename}`);
  }

  const lines = file.patch.split("\n");
  let currentChunk: string[] = [];
  const chunks: PRFile[] = [];
  let currentStartLine = 1; // Start tracking the line numbers

  lines.forEach((line, index) => {
    currentChunk.push(line);
    const chunkAsString = currentChunk.join("\n");

    const isWithinLimit = isConversationWithinLimit(
      constructPrompt(
        [{ ...file, patch: chunkAsString }],
        patchBuilder,
        convoBuilder
      )
    );

    if (isWithinLimit) {
      // Check if this is the end of a function or class
      const enclosingContext = parser.findEnclosingContext(
        file.current_contents,
        currentStartLine,
        index + 1
      );

      if (enclosingContext.enclosingContext === null) {
        // Finalize the chunk
        chunks.push({
          ...file,
          patch: chunkAsString,
          patchTokenLength: getTokenLength(chunkAsString), // Optional: calculate token length
          old_contents: file.old_contents, // Preserve old contents for context
          current_contents: file.current_contents, // Preserve current contents
        });
        currentChunk = [];
        currentStartLine = index + 2; // Move to the next line
      }
    } else if (currentChunk.length > 1) {
      // Exceeds limit; finalize the current chunk without breaking context
      currentChunk.pop(); // Remove the last line
      const finalizedChunk = currentChunk.join("\n");
      chunks.push({
        ...file,
        patch: finalizedChunk,
        patchTokenLength: getTokenLength(finalizedChunk),
        old_contents: file.old_contents,
        current_contents: file.current_contents,
      });
      currentChunk = [line]; // Start a new chunk with the last line
      currentStartLine = index + 1; // Update start line for the new chunk
    }
  });

  if (currentChunk.length > 0) {
    // Add any remaining lines as a final chunk
    chunks.push({
      ...file,
      patch: currentChunk.join("\n"),
      patchTokenLength: getTokenLength(currentChunk.join("\n")),
      old_contents: file.old_contents,
      current_contents: file.current_contents,
    });
  }

  return chunks;
};

const processXMLSuggestions = async (feedbacks: string[]) => {
  const xmlParser = new xml2js.Parser();
  const parsedSuggestions = await Promise.all(
    feedbacks.map((fb) => {
      fb = fb
        .split("<code>")
        .join("<code><![CDATA[")
        .split("</code>")
        .join("]]></code>");
      console.log(fb);
      return xmlParser.parseStringPromise(fb);
    })
  );
  // gets suggestion arrays [[suggestion], [suggestion]], then flattens
  const allSuggestions = parsedSuggestions
    .map((sug) => sug.review.suggestion)
    .flat(1);
  const suggestions: PRSuggestion[] = allSuggestions.map((rawSuggestion) => {
    const lines = rawSuggestion.code[0].trim().split("\n");
    lines[0] = lines[0].trim();
    lines[lines.length - 1] = lines[lines.length - 1].trim();
    const code = lines.join("\n");

    return new PRSuggestionImpl(
      rawSuggestion.describe[0],
      rawSuggestion.type[0],
      rawSuggestion.comment[0],
      code,
      rawSuggestion.filename[0]
    );
  });
  return suggestions;
};

const generateGithubIssueUrl = (
  owner: string,
  repoName: string,
  title: string,
  body: string,
  codeblock?: string
) => {
  const encodedTitle = encodeURIComponent(title);
  const encodedBody = encodeURIComponent(body);
  const encodedCodeBlock = codeblock
    ? encodeURIComponent(`\n${codeblock}\n`)
    : "";

  let url = `https://github.com/${owner}/${repoName}/issues/new?title=${encodedTitle}&body=${encodedBody}${encodedCodeBlock}`;

  if (url.length > 2048) {
    url = `https://github.com/${owner}/${repoName}/issues/new?title=${encodedTitle}&body=${encodedBody}`;
  }
  return `[Create Issue](${url})`;
};

/****** START ADDED CODE ********/
const generateGithubCommitUrl = (
  owner: string,
  repoName: string,
  branch: string,
  commitMessage: string,
  changesDescription?: string,
  codeblock?: string
) => {
  const encodedCommitMessage = encodeURIComponent(commitMessage);
  const encodedChangesDescription = changesDescription
    ? encodeURIComponent(`\nChanges: ${changesDescription}\n`)
    : "";
  const encodedCodeBlock = codeblock
    ? encodeURIComponent(`\n${codeblock}\n`)
    : "";

  let url = `https://github.com/${owner}/${repoName}/commit/${branch}?message=${encodedCommitMessage}${encodedChangesDescription}${encodedCodeBlock}`;

  if (url.length > 2048) {
    url = `https://github.com/${owner}/${repoName}/commit/${branch}?message=${encodedCommitMessage}`;
  }
  return `[Create Commit](${url})`;
};
/****** END ADDED CODE ********/

export const dedupSuggestions = (
  suggestions: PRSuggestion[]
): PRSuggestion[] => {
  const suggestionsMap = new Map<string, PRSuggestion>();
  suggestions.forEach((suggestion) => {
    suggestionsMap.set(suggestion.identity(), suggestion);
  });
  return Array.from(suggestionsMap.values());
};

const convertPRSuggestionToComment = (
  owner: string,
  repo: string,
  suggestions: PRSuggestion[]
): string[] => {
  const suggestionsMap = new Map<string, PRSuggestion[]>();
  suggestions.forEach((suggestion) => {
    if (!suggestionsMap.has(suggestion.filename)) {
      suggestionsMap.set(suggestion.filename, []);
    }
    suggestionsMap.get(suggestion.filename).push(suggestion);
  });
  const comments: string[] = [];
  for (let [filename, suggestions] of suggestionsMap) {
    const temp = [`## ${filename}\n`];
    suggestions.forEach((suggestion: PRSuggestion) => {
      const issueLink = generateGithubIssueUrl(
        owner,
        repo,
        suggestion.describe,
        suggestion.comment,
        suggestion.code
      );
      temp.push(
        PR_SUGGESTION_TEMPLATE.replace("{COMMENT}", suggestion.comment)
          .replace("{CODE}", suggestion.code)
          .replace("{ISSUE_LINK}", issueLink)
      );
    });
    comments.push(temp.join("\n"));
  }
  return comments;
};

const xmlResponseBuilder = async (
  owner: string,
  repoName: string,
  feedbacks: string[]
): Promise<BuilderResponse> => {
  console.log("IN XML RESPONSE BUILDER");
  const parsedXMLSuggestions = await processXMLSuggestions(feedbacks);
  console.log(
    "In review-agent.ts/xmlResponseBuilder - parsedXMLSuggestions: " +
      parsedXMLSuggestions
  );

  const comments = convertPRSuggestionToComment(
    owner,
    repoName,
    dedupSuggestions(parsedXMLSuggestions)
  );
  const commentBlob = comments.join("\n");
  console.log(
    "In review-agent.ts/xmlResponseBuilder - commentBlob: " + commentBlob
  );

  return { comment: commentBlob, structuredComments: parsedXMLSuggestions };
};

const curriedXmlResponseBuilder = (owner: string, repoName: string) => {
  return (feedbacks: string[]) =>
    xmlResponseBuilder(owner, repoName, feedbacks);
};

const basicResponseBuilder = async (
  feedbacks: string[]
): Promise<BuilderResponse> => {
  const commentBlob = feedbacks.join("\n");
  console.log(`IN BASIC RESPONSE BUILDER ${commentBlob.slice(0, 50)}`);
  return { comment: commentBlob, structuredComments: [] };
};

export const reviewChanges = async (
  files: PRFile[],
  convoBuilder: (diff: string) => ChatCompletionMessageParam[],
  responseBuilder: (responses: string[]) => Promise<BuilderResponse>
) => {
  const patchBuilder = buildPatchPrompt;
  const filteredFiles = files.filter((file) => filterFile(file));
  filteredFiles.map((file) => {
    file.patchTokenLength = getTokenLength(patchBuilder(file));
  });
  console.log("In review-agent.ts/reviewChanges: Initiate patching files");
  // further subdivide if necessary, maybe group files by common extension?
  const patchesWithinModelLimit: PRFile[] = [];
  // these single file patches are larger than the full model context
  const patchesOutsideModelLimit: PRFile[] = [];

  filteredFiles.forEach((file) => {
    const patchWithPromptWithinLimit = isConversationWithinLimit(
      constructPrompt([file], patchBuilder, convoBuilder)
    );
    if (patchWithPromptWithinLimit) {
      patchesWithinModelLimit.push(file);
    } else {
      patchesOutsideModelLimit.push(file);
    }
  });

  const withinLimitsPatchGroups = processWithinLimitFiles(
    patchesWithinModelLimit,
    patchBuilder,
    convoBuilder
  );
  const exceedingLimitsPatchGroups = processOutsideLimitFiles(
    patchesOutsideModelLimit,
    patchBuilder,
    convoBuilder
  );
  console.log(
    `In review-agent.ts/reviewChanges: ${withinLimitsPatchGroups.length} within limits groups.`
  );
  console.log(
    `In review-agent.ts/reviewChanges: ${patchesOutsideModelLimit.length} files outside limit, skipping them.`
  );

  const groups = [...withinLimitsPatchGroups, ...exceedingLimitsPatchGroups];

  const feedbacks = await Promise.all(
    groups.map((patchGroup) => {
      return reviewFiles(patchGroup, patchBuilder, convoBuilder);
    })
  );
  try {
    return await responseBuilder(feedbacks);
  } catch (exc) {
    console.log("XML parsing error");
    console.log(exc);
    throw exc;
  }
};

const indentCodeFix = (
  file: string,
  code: string,
  lineStart: number
): string => {
  const fileLines = file.split("\n");
  const firstLine = fileLines[lineStart - 1];
  const codeLines = code.split("\n");
  const indentation = firstLine.match(/^(\s*)/)[0];
  const indentedCodeLines = codeLines.map((line) => indentation + line);
  return indentedCodeLines.join("\n");
};

const isCodeSuggestionNew = (
  contents: string,
  suggestion: CodeSuggestion
): boolean => {
  const fileLines = contents.split("\n");
  const targetLines = fileLines
    .slice(suggestion.line_start - 1, suggestion.line_end)
    .join("\n");
  if (targetLines.trim() == suggestion.correction.trim()) {
    // same as existing code.
    return false;
  }
  return true;
};

export const generateInlineComments = async (
  suggestion: PRSuggestion,
  file: PRFile
): Promise<CodeSuggestion> => {
  try {
    const messages = getInlineFixPrompt(file.current_contents, suggestion);
    console.log(
      "In review-agent.ts/generateInLineComments - messages getInLineFixPrompt: ",
      messages[0]
    );
    const { function_call } = await generateChatCompletion({
      messages,
      functions: [INLINE_FIX_FUNCTION],
      function_call: { name: INLINE_FIX_FUNCTION.name },
    });
    if (!function_call) {
      throw new Error("No function call found");
    }
    const args = JSON.parse(function_call.arguments);
    const initialCode = String.raw`${args["code"]}`;
    const indentedCode = indentCodeFix(
      file.current_contents,
      initialCode,
      args["lineStart"]
    );
    const codeFix = {
      file: suggestion.filename,
      line_start: args["lineStart"],

      line_end: args["lineEnd"],
      correction: indentedCode,
      comment: args["comment"],
    };
    if (isCodeSuggestionNew(file.current_contents, codeFix)) {
      return codeFix;
    }
    return null;
  } catch (exc) {
    console.log(exc);
    return null;
  }
};

const preprocessFile = async (
  octokit: Octokit,
  payload: WebhookEventMap["pull_request"],
  file: PRFile
) => {
  const { base, head } = payload.pull_request;
  const baseBranch: BranchDetails = {
    name: base.ref,
    sha: base.sha,
    url: payload.pull_request.url,
  };
  const currentBranch: BranchDetails = {
    name: head.ref,
    sha: head.sha,
    url: payload.pull_request.url,
  };
  // Handle scenario where file does not exist!!
  const [oldContents, currentContents] = await Promise.all([
    getGitFile(octokit, payload, baseBranch, file.filename),
    getGitFile(octokit, payload, currentBranch, file.filename),
  ]);

  if (oldContents.content != null) {
    file.old_contents = String.raw`${oldContents.content}`;
  } else {
    file.old_contents = null;
  }

  if (currentContents.content != null) {
    file.current_contents = String.raw`${currentContents.content}`;
  } else {
    file.current_contents = null;
  }
};

const reviewChangesRetry = async (files: PRFile[], builders: Builders[]) => {
  for (const { convoBuilder, responseBuilder } of builders) {
    try {
      console.log(
        `In review-agents.ts/reviewChangesRetry: Trying with convoBuilder: ${convoBuilder.name}.`
      );
      return await reviewChanges(files, convoBuilder, responseBuilder);
    } catch (error) {
      console.log(
        `In review-agents.ts/reviewChangesRetry: Error with convoBuilder: ${convoBuilder.name}, trying next one. Error: ${error}`
      );
    }
  }
  throw new Error("All convoBuilders failed.");
};

export const processPullRequest = async (
  octokit: Octokit,
  payload: WebhookEventMap["pull_request"],
  files: PRFile[],
  includeSuggestions = false
) => {
  console.dir({ files }, { depth: null });
  const filteredFiles = files.filter((file) => filterFile(file));
  console.dir({ filteredFiles }, { depth: null });
  if (filteredFiles.length == 0) {
    console.log("nothing to comment on");
    return {
      review: null,
      suggestions: [],
    };
  }
  await Promise.all(
    filteredFiles.map((file) => {
      return preprocessFile(octokit, payload, file);
    })
  );
  const owner = payload.repository.owner.login;
  const repoName = payload.repository.name;
  const curriedXMLResponseBuilder = curriedXmlResponseBuilder(owner, repoName);
  if (includeSuggestions) {
    const reviewComments = await reviewChangesRetry(filteredFiles, [
      {
        convoBuilder: getXMLReviewPrompt,
        responseBuilder: curriedXMLResponseBuilder,
      },
      {
        convoBuilder: getReviewPrompt,
        responseBuilder: basicResponseBuilder,
      },
    ]);
    let inlineComments: CodeSuggestion[] = [];
    if (reviewComments.structuredComments.length > 0) {
      console.log(
        "In review-agent.ts/processPullRequest: STARTING INLINE COMMENT PROCESSING"
      );
      inlineComments = await Promise.all(
        reviewComments.structuredComments.map((suggestion) => {
          // find relevant file
          const file = files.find(
            (file) => file.filename === suggestion.filename
          );
          if (file == null) {
            return null;
          }
          return generateInlineComments(suggestion, file);
        })
      );
    }
    const filteredInlineComments = inlineComments.filter(
      (comment) => comment !== null
    );
    return {
      review: reviewComments,
      suggestions: filteredInlineComments,
    };
  } else {
    const [review] = await Promise.all([
      reviewChangesRetry(filteredFiles, [
        {
          convoBuilder: getXMLReviewPrompt,
          responseBuilder: curriedXMLResponseBuilder,
        },
        {
          convoBuilder: getReviewPrompt,
          responseBuilder: basicResponseBuilder,
        },
      ]),
    ]);

    return {
      review,
      suggestions: [],
    };
  }
};
