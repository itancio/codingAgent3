import { Octokit } from "@octokit/rest";
import { createNodeMiddleware } from "@octokit/webhooks";
import { WebhookEventMap } from "@octokit/webhooks-definitions/schema";
import * as http from "http";
import { App } from "octokit";
import { Review } from "./constants";
import { env } from "./env";
import { processPullRequest } from "./review-agent";
import { applyReview } from "./reviews";

// This creates a new instance of the Octokit App class.
const reviewApp = new App({
  appId: env.GITHUB_APP_ID,
  privateKey: env.GITHUB_PRIVATE_KEY,
  webhooks: {
    secret: env.GITHUB_WEBHOOK_SECRET,
  },
});

const getChangesPerFile = async (payload: WebhookEventMap["pull_request"]) => {
  try {
    const octokit = await reviewApp.getInstallationOctokit(
      payload.installation.id
    );
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      pull_number: payload.pull_request.number,
    });
    console.dir({ files }, { depth: null });
    return files;
  } catch (exc) {
    console.log("exc");
    return [];
  }
};

// This adds an event handler that your code will call later.
// When this event handler is called, it will log the event to the console.
// Then, it will use GitHub's REST API to add a comment to the pull request that triggered the event.
async function handlePullRequestOpened({
  octokit,
  payload,
}: {
  octokit: Octokit;
  payload: WebhookEventMap["pull_request"];
}) {
  console.log(
    `Received a pull request event for #${payload.pull_request.number}`
  );

  try {
    console.log("PR Info:", {
      id: payload.repository.id,
      fullName: payload.repository.full_name,
      url: payload.repository.html_url,
    });

    // Get the changes in the PR
    const files = await getChangesPerFile(payload);

    // Process the pull request to generate a review
    const review: Review = await processPullRequest(
      octokit,
      payload,
      files,
      true
    );

    // Apply the review to the PR
    await applyReview({ octokit, payload, review });
    console.log("Review Submitted");
  } catch (exc) {
    console.error("Error handling pull request:", exc);
  }
}

// This sets up a webhook event listener.
// When your app receives a webhook event from GitHub with a `X-GitHub-Event` header value
// of `pull_request` and an `action` payload value of `opened`, it calls the `handlePullRequestOpened`
// event handlerthat is defined above.
//@ts-ignore
// This sets up a webhook event listener for pull requests
reviewApp.webhooks.on("pull_request", async (context) => {
  const { action, pull_request, repository } = context.payload;

  if (["opened", "edited", "synchronize"].includes(action)) {
    console.log(
      `ADD THIS: Handling pull request action '${action}' for #${pull_request.number} in repository ${repository.full_name}`
    );

    await handlePullRequestOpened({
      octokit: context.octokit,
      payload: context.payload,
    });
  }
});

const port = process.env.PORT || 3000;
const reviewWebhook = `/api/review`;

const reviewMiddleware = createNodeMiddleware(reviewApp.webhooks, {
  path: "/api/review",
});

const server = http.createServer((req, res) => {
  if (req.url === reviewWebhook) {
    reviewMiddleware(req, res);
  } else {
    res.statusCode = 404;
    res.end();
  }
});

// This creates a Node.js server that listens for incoming HTTP requests (including webhook payloads from GitHub) on the specified port. When the server receives a request, it executes the `middleware` function that you defined earlier. Once the server is running, it logs messages to the console to indicate that it is listening.
server.listen(port, () => {
  console.log(`Server in port ${port} is listening for events.`);
  console.log("Press Ctrl + C to quit.");
});
