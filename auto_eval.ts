import { CopilotClient, approveAll } from "@github/copilot-sdk";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { randomUUID, createHash } from "crypto";
import { resolve, join } from "path";
import { parse as parseYaml } from "yaml";

// ─────────────────────────────────────────────────────────────
// Config Loading
// ─────────────────────────────────────────────────────────────

interface Config {
  agent: { prompt_path: string; skills_dir: string };
  model: { name: string };
  questions: { csv_path: string };
  execution: {
    timeout_seconds: number;
    retries: number;
    retry_delay_ms: number;
    save_partial: boolean;
  };
  output: { file: string; validate: boolean };
}

function loadConfig(): Config {
  const configPath = resolve(process.cwd(), "config.yaml");
  if (!existsSync(configPath)) {
    console.error("\n❌ config.yaml not found in project root.");
    console.error("   Copy config.yaml.example to config.yaml and fill in your settings.\n");
    process.exit(1);
  }
  const raw = readFileSync(configPath, "utf-8");
  return parseYaml(raw) as Config;
}

// ─────────────────────────────────────────────────────────────
// Agent Prompt Path Resolution
// ─────────────────────────────────────────────────────────────

function resolveAgentPromptPath(config: Config): string {
  if (config.agent.prompt_path !== "auto") {
    return config.agent.prompt_path;
  }
  // Auto-detect: look for .md files in the skills dir
  const skillsDir = resolve(process.cwd(), config.agent.skills_dir);
  if (!existsSync(skillsDir)) {
    console.error(`\n❌ Skills directory not found: ${skillsDir}`);
    console.error("   Ensure your agent skill files are in the configured skills_dir.\n");
    process.exit(1);
  }
  return `workspace://${config.agent.skills_dir}`;
}

// ─────────────────────────────────────────────────────────────
// Skill Files Loading
// ─────────────────────────────────────────────────────────────

function loadSkillContent(config: Config): string {
  const skillRoot = resolve(process.cwd(), config.agent.skills_dir);
  const skillMdPath = resolve(skillRoot, "SKILL.md");
  const refPath = resolve(skillRoot, "reference/instructions.md");

  if (!existsSync(skillMdPath)) {
    console.error(`\n❌ SKILL.md not found at: ${skillMdPath}`);
    process.exit(1);
  }

  let content = readFileSync(skillMdPath, "utf-8");
  if (existsSync(refPath)) {
    content += `\n\n---\n\n${readFileSync(refPath, "utf-8")}`;
  }
  return content;
}

// ─────────────────────────────────────────────────────────────
// CSV Parsing (using proper field handling)
// ─────────────────────────────────────────────────────────────

interface Question {
  text: string;
  category: string;
}

function loadQuestions(csvPath: string): Question[] {
  const fullPath = resolve(process.cwd(), csvPath);
  if (!existsSync(fullPath)) {
    console.error(`\n❌ Questions file not found: ${fullPath}`);
    process.exit(1);
  }

  const content = readFileSync(fullPath, "utf-8").trim();
  const lines = content.split(/\r?\n/);
  const header = lines[0].toLowerCase();

  if (!header.includes("question")) {
    console.error("\n❌ CSV must have a 'question' column in the header row.");
    process.exit(1);
  }

  // Parse CSV respecting quoted fields.
  // CSV format: question, category. (Marking criteria stay server-side.)
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    return {
      text: fields[0]?.trim() ?? "",
      category: fields[1]?.trim() ?? "general",
    };
  }).filter((q) => q.text.length > 0);
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

// ─────────────────────────────────────────────────────────────
// Trace Types
// ─────────────────────────────────────────────────────────────

interface RawEvent {
  type: string;
  timestamp: number;
  data: unknown;
}

interface RequestRecord {
  requestId: string;
  responseId: string;
  timestamp: number;
  modelId: string;
  agent: string;
  message: { text: string; parts: Array<{ kind: string; value: string }> };
  prompt: string;
  response: string;
  followups: unknown[];
  variableData: Record<string, unknown>;
  timeSpentWaiting: number;
  modelState: { completedAt: number };
  latencyMs: number;
  contentReferences: unknown[];
  codeCitations: unknown[];
  rawEvents: RawEvent[];
  result: { text: string; details: string };
}

interface SessionRecord {
  sessionId: string;
  timestamp: string;
  creationDate: number;
  customTitle: string;
  responderUsername: string;
  modelId: string;
  initialLocation: string;
  inputState: {
    mode: { id: string; kind: string };
    selectedModel: { identifier: string };
    attachments: unknown[];
    inputText: string;
    selections: unknown[];
    contrib: Record<string, unknown>;
  };
  requests: RequestRecord[];
}

interface SessionWrapper {
  version: number;
  hasPendingEdits: boolean;
  pendingRequests: unknown[];
  data: SessionRecord;
}

interface TraceOutput {
  since_filter: null;
  workspace_count: number;
  workspaces: Record<string, { workspacePath: string; sessions: SessionWrapper[] }>;
}

// ─────────────────────────────────────────────────────────────
// Retry Helper
// ─────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  delayMs: number,
  label: string
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt <= retries) {
        console.warn(`  ⚠️  Attempt ${attempt} failed for "${label}": ${lastError.message}`);
        console.warn(`     Retrying in ${delayMs / 1000}s... (${retries - attempt + 1} retries left)`);
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────────────────────
// Partial Save
// ─────────────────────────────────────────────────────────────

function savePartialResults(
  sessions: SessionWrapper[],
  outputFile: string,
  workspaceHash: string
): void {
  const partialFile = outputFile.replace(".json", ".partial.json");
  const output: TraceOutput = {
    since_filter: null,
    workspace_count: 1,
    workspaces: {
      [workspaceHash]: { workspacePath: process.cwd(), sessions },
    },
  };
  writeFileSync(partialFile, JSON.stringify(output, null, 2));
  console.log(`  💾 Partial results saved to ${partialFile}`);
}

// ─────────────────────────────────────────────────────────────
// Main Eval Runner
// ─────────────────────────────────────────────────────────────

async function runEval(): Promise<void> {
  console.log("\n🚀 Gastown Eval Kit\n");

  // Load configuration
  const config = loadConfig();
  console.log(`  Model:     ${config.model.name}`);
  console.log(`  Questions: ${config.questions.csv_path}`);
  console.log(`  Output:    ${config.output.file}`);
  console.log(`  Retries:   ${config.execution.retries}`);
  console.log("");

  // Resolve paths and load skills
  const agentPromptPath = resolveAgentPromptPath(config);
  const skillContent = loadSkillContent(config);
  const questions = loadQuestions(config.questions.csv_path);

  console.log(`  Loaded ${questions.length} questions\n`);
  console.log("─".repeat(60));

  // Start Copilot client
  const client = new CopilotClient({ autoStart: true, autoRestart: true });
  await client.start();

  const workspaceHash = createHash("sha256").update(process.cwd()).digest("hex");
  const sessions: SessionWrapper[] = [];
  let failures = 0;

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const questionLabel = question.text.length > 55
      ? question.text.slice(0, 52) + "..."
      : question.text;

    console.log(`\n  [${i + 1}/${questions.length}] ${questionLabel}`);

    try {
      const sessionWrapper = await withRetry(
        () => evaluateQuestion(client, question, config, agentPromptPath, skillContent),
        config.execution.retries,
        config.execution.retry_delay_ms,
        questionLabel
      );

      sessions.push(sessionWrapper);
      const latency = sessionWrapper.data.requests[0]?.latencyMs ?? 0;
      console.log(`  ✅ ${latency}ms | category: ${question.category}`);
    } catch (err) {
      failures++;
      console.error(`  ❌ FAILED after ${config.execution.retries + 1} attempts: ${(err as Error).message}`);

      // Save partial results on failure if configured
      if (config.execution.save_partial && sessions.length > 0) {
        savePartialResults(sessions, config.output.file, workspaceHash);
      }
    }
  }

  await client.stop();

  // Write final output
  console.log("\n" + "─".repeat(60));

  if (sessions.length === 0) {
    console.error("\n❌ No successful evaluations. Nothing to write.");
    process.exit(1);
  }

  const output: TraceOutput = {
    since_filter: null,
    workspace_count: 1,
    workspaces: {
      [workspaceHash]: { workspacePath: process.cwd(), sessions },
    },
  };

  writeFileSync(config.output.file, JSON.stringify(output, null, 2));

  console.log(`\n✅ Done! ${sessions.length} sessions written to ${config.output.file}`);
  if (failures > 0) {
    console.warn(`⚠️  ${failures} question(s) failed and were skipped.`);
  }
  console.log("");
}

// ─────────────────────────────────────────────────────────────
// Single Question Evaluation
// ─────────────────────────────────────────────────────────────

async function evaluateQuestion(
  client: CopilotClient,
  question: Question,
  config: Config,
  agentPromptPath: string,
  skillContent: string
): Promise<SessionWrapper> {
  const sessionId = randomUUID();
  const sessionCreationDate = Date.now();
  const model = config.model.name;

  const session = await client.createSession({
    model,
    streaming: true,
    onPermissionRequest: approveAll,
    systemMessage: {
      mode: "customize",
      sections: {
        custom_instructions: { action: "replace", content: skillContent },
      },
    },
  });

  const requestId = randomUUID();
  const responseId = randomUUID();
  const rawEvents: RawEvent[] = [];
  let accumulated = "";

  const unsub = session.on("assistant.message_delta", (event: { data: { deltaContent: string } }) => {
    accumulated += event.data.deltaContent;
    rawEvents.push({
      type: "assistant.message_delta",
      timestamp: Date.now(),
      data: { deltaContent: event.data.deltaContent },
    });
  });

  // Capture additional events
  const sessionEmitter = session as unknown as {
    on: (event: string, cb: (...args: unknown[]) => void) => () => void;
  };
  const otherUnsubs: Array<() => void> = [];
  for (const eventName of ["turn.complete", "tool.call", "tool.result", "assistant.message", "error"]) {
    const u = sessionEmitter.on(eventName, (...args: unknown[]) => {
      rawEvents.push({ type: eventName, timestamp: Date.now(), data: args });
    });
    otherUnsubs.push(u);
  }

  const sentAt = Date.now();
  rawEvents.push({ type: "request.sent", timestamp: sentAt, data: { prompt: question.text } });

  await session.sendAndWait({ prompt: question.text }, config.execution.timeout_seconds * 1000);

  const completedAt = Date.now();
  rawEvents.push({ type: "response.complete", timestamp: completedAt, data: { response: accumulated } });

  unsub();
  otherUnsubs.forEach((u) => u());

  const requestRecord: RequestRecord = {
    requestId,
    responseId,
    timestamp: sentAt,
    modelId: `copilot/${model}`,
    agent: agentPromptPath,
    message: {
      text: question.text,
      parts: [{ kind: "text", value: question.text }],
    },
    prompt: question.text,
    response: accumulated,
    followups: [],
    variableData: { category: question.category },
    timeSpentWaiting: sentAt,
    modelState: { completedAt },
    latencyMs: completedAt - sentAt,
    contentReferences: [],
    codeCitations: [],
    rawEvents,
    result: { text: accumulated, details: model },
  };

  const sessionRecord: SessionRecord = {
    sessionId,
    timestamp: new Date(sessionCreationDate).toISOString(),
    creationDate: sessionCreationDate,
    customTitle: question.text.length > 60 ? question.text.slice(0, 57) + "..." : question.text,
    responderUsername: "GitHub Copilot",
    modelId: `copilot/${model}`,
    initialLocation: "panel",
    inputState: {
      mode: { id: agentPromptPath, kind: "agent" },
      selectedModel: { identifier: `copilot/${model}` },
      attachments: [],
      inputText: question.text,
      selections: [],
      contrib: {},
    },
    requests: [requestRecord],
  };

  return { version: 3, hasPendingEdits: false, pendingRequests: [], data: sessionRecord };
}

// ─────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────

runEval().catch((err) => {
  console.error(`\n❌ Fatal error: ${err.message}`);
  process.exit(1);
});
