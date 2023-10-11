import * as github from "@actions/github";
import * as core from "@actions/core";
import { readFileSync } from "fs";
import { join } from "path";
import https from "node:https";
import { stringify } from "querystring";
const load = require('@commitlint/load').default;
const lint = require('@commitlint/lint').default;

const context = github.context;
let octokit: ReturnType<typeof github.getOctokit>;

type ConfigType = {
  LABEL: {
    name: string;
    color: string;
  };
  CHECKS: {
    ignoreLabels: string[];
    regexp: string;
    regexpFlags: string;
    prefixes: string[];
    alwaysPassCI: boolean;
  };
  MESSAGES: {
    success: string;
    failure: string;
    notice: string;
  };
};

async function createLabel({
  label: { name, color },
}: {
  label: ConfigType["LABEL"];
}) {
  if (name === "") {
    return;
  }

  try {
    core.info(`Creating label (${name})...`);
    let createResponse = await octokit.rest.issues.createLabel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      name: name,
      color: color,
    });
    core.info(`Created label (${name}) - ${createResponse.status}`);
  } catch (error) {
    // Might not always be due to label's existence
    core.info(`Label (${name}) already created.`);
  }
}

async function removeLabel({
  labels,
  name,
}: {
  name: string;
  labels: ConfigType["LABEL"][];
}) {
  if (name === "") {
    return;
  }

  try {
    if (
      !labels
        .map((label) => label.name.toLowerCase())
        .includes(name.toLowerCase())
    ) {
      return;
    }

    core.info("No formatting necessary. Removing label...");
    let removeLabelResponse = await octokit.rest.issues.removeLabel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      name: name,
    });
    core.info(`Removed label - ${removeLabelResponse.status}`);
  } catch (error) {
    core.info(`Failed to remove label (${name}) from PR: ${error}`);
  }
}

function downloadJSON(url: URL): Promise<ConfigType> {
  return new Promise<ConfigType>((resolve, reject) => {
    const req = https.request(url, (res) => {
      let responseBody = "";

      res.on("data", (d) => {
        responseBody += d;
      });
      res.on("end", () => {
        resolve(JSON.parse(responseBody.toString()));
      });
    });
    req.on("error", (e) => {
      reject(e);
    });
    req.end();
  });
}

async function getJSON({
  configPath,
  localConfigPath,
  remoteConfigURL,
  GitHubConfigOwner,
  GitHubConfigRepo,
  GitHubConfigPath,
  GitHubConfigRef,
  GitHubConfigToken,
}: {
  configPath: string;
  localConfigPath?: string;
  remoteConfigURL?: string;
  GitHubConfigOwner?: string;
  GitHubConfigRepo?: string;
  GitHubConfigPath?: string;
  GitHubConfigRef?: string;
  GitHubConfigToken?: string;
}): Promise<ConfigType> {
  if (localConfigPath) {
    core.info(`Using local config file ${localConfigPath}`);
    const data = readFileSync(join(process.cwd(), localConfigPath));
    return JSON.parse(data.toString());
  }
  if (remoteConfigURL) {
    core.info(`Using remote config file ${remoteConfigURL}`);
    const url = new URL(remoteConfigURL);
    return await downloadJSON(url);
  }

  const is_same_repo =
    (!GitHubConfigOwner || GitHubConfigOwner === context.repo.owner) &&
    (!GitHubConfigRepo || GitHubConfigRepo === context.repo.repo);

  core.info(
    `Using config file ${GitHubConfigPath || configPath} from repo ${
      GitHubConfigOwner || context.repo.owner
    }/${GitHubConfigRepo || context.repo.repo} [ref: ${
      GitHubConfigRef ||
      (is_same_repo ? context.sha : "latest commit on the default branch")
    }]`
  );
  let _octokit = octokit;
  if (GitHubConfigToken) {
    _octokit = github.getOctokit(GitHubConfigToken);
  }

  const response = await _octokit.rest.repos.getContent({
    owner: GitHubConfigOwner || context.repo.owner,
    repo: GitHubConfigRepo || context.repo.repo,
    path: GitHubConfigPath || configPath,
    ref: GitHubConfigRef || (is_same_repo ? context.sha : undefined),
  });

  return JSON.parse(
    Buffer.from(
      (response.data as any).content,
      (response.data as any).encoding
    ).toString()
  );
}

async function handleOctokitError({
  passOnOctokitError,
  error,
}: {
  passOnOctokitError: boolean;
  error: Error;
}) {
  core.info(`Octokit Error - ${error}`);
  if (passOnOctokitError) {
    core.info("Passing CI regardless");
  } else {
    core.setFailed("Failing CI test");
  }
}

const run = async ({
  configPath,
  localConfigPath,
  remoteConfigURL,
  GitHubConfigOwner,
  GitHubConfigRepo,
  GitHubConfigPath,
  GitHubConfigRef,
  GitHubConfigToken,
}: {
  configPath: string;
  localConfigPath: string;
  remoteConfigURL?: string;
  GitHubConfigOwner?: string;
  GitHubConfigRepo?: string;
  GitHubConfigPath?: string;
  GitHubConfigRef?: string;
  GitHubConfigToken?: string;
}) => {
  if (!context || !context.payload || !context.payload.pull_request) {
    return;
  }

  try {
    const title = context.payload.pull_request.title;
    const body = context.payload.pull_request.body;
    const labels = context.payload.pull_request.labels;


    let config: ConfigType;
    try {
      config = await getJSON({
        configPath,
        localConfigPath,
        remoteConfigURL,
        GitHubConfigOwner,
        GitHubConfigRepo,
        GitHubConfigPath,
        GitHubConfigRef,
        GitHubConfigToken,
      });
    } catch (e) {
      core.setFailed(
        `Couldn't retrieve or parse the config file specified - ${e}`
      );
      return;
    }

    let { CHECKS, LABEL, MESSAGES } = config;
    LABEL = LABEL || ({} as ConfigType["LABEL"]);
    LABEL.name = LABEL.name || "";
    LABEL.color = LABEL.color || "eee";
    CHECKS.ignoreLabels = CHECKS.ignoreLabels || [];
    MESSAGES = MESSAGES || ({} as ConfigType["MESSAGES"]);
    MESSAGES.success = MESSAGES.success || "All OK";
    MESSAGES.failure = MESSAGES.failure || "Failing CI test";
    MESSAGES.notice = MESSAGES.notice || "";

    await createLabel({ label: LABEL });


    const commitlint_input = title + "\n\n" + body;

    const CONFIG = {
      extends: ['@commitlint/config-conventional'],
    };

    load(CONFIG)
      .then((opts: any) =>
        lint(
          commitlint_input,
          opts.rules,
          opts.parserPreset ? {parserOpts: opts.parserPreset.parserOpts} : {}
        )
      )
      .then((report: any) => {
        if(report.value) {
          removeLabel({ labels, name: LABEL.name });
          core.info(MESSAGES.success);
        } else {
          core.info(stringify(report));
        }
        console.log(report)
      });
    /* =>
        { valid: false,
          errors:
          [ { level: 2,
              valid: false,
              name: 'type-enum',
              message: 'type must be one of [build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test]' } ],
          warnings: [] }
        */

  } catch (error) {
    core.info(error);
  }
};

const configPath = core.getInput("configuration_path")!;
const localConfigPath = core.getInput("local_configuration_path");
const remoteConfigURL = core.getInput("remote_configuration_url");
const GitHubConfigOwner = core.getInput("github_configuration_owner");
const GitHubConfigRepo = core.getInput("github_configuration_repo");
const GitHubConfigPath = core.getInput("github_configuration_path");
const GitHubConfigRef = core.getInput("github_configuration_ref");
const GitHubConfigToken = core.getInput("github_configuration_token");
const passOnOctokitError = core.getInput("pass_on_octokit_error") === "true";
const token = core.getInput("GITHUB_TOKEN");

try {
  octokit = github.getOctokit(token);
  run({
    configPath,
    localConfigPath,
    remoteConfigURL,
    GitHubConfigOwner,
    GitHubConfigRepo,
    GitHubConfigPath,
    GitHubConfigRef,
    GitHubConfigToken,
  });
} catch (e) {
  handleOctokitError({ passOnOctokitError, error: e });
}
