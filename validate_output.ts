import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse as parseYaml } from "yaml";

// ─────────────────────────────────────────────────────────────
// Gastown Eval Kit — Output Validator
// Validates ghcp_eval_traces.json against the leaderboard schema
// ─────────────────────────────────────────────────────────────

interface ValidationError {
  path: string;
  message: string;
}

function validate(): void {
  console.log("\n🔍 Gastown Eval Kit — Output Validator\n");

  // Load config to find output file
  const configPath = resolve(process.cwd(), "config.yaml");
  let outputFile = "ghcp_eval_traces.json";

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf-8");
    const config = parseYaml(raw);
    outputFile = config?.output?.file ?? outputFile;
  }

  const outputPath = resolve(process.cwd(), outputFile);

  if (!existsSync(outputPath)) {
    console.error(`❌ Output file not found: ${outputFile}`);
    console.error("   Run 'npm run eval' first to generate the traces file.\n");
    process.exit(1);
  }

  console.log(`  Validating: ${outputFile}\n`);

  let data: unknown;
  try {
    const raw = readFileSync(outputPath, "utf-8");
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Failed to parse JSON: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const errors = validateTraceOutput(data);

  if (errors.length === 0) {
    console.log("✅ Validation passed! Output is ready for leaderboard submission.\n");

    // Print summary
    const trace = data as Record<string, unknown>;
    const workspaces = trace.workspaces as Record<string, { sessions: unknown[] }>;
    const workspaceKeys = Object.keys(workspaces);
    let totalSessions = 0;
    for (const key of workspaceKeys) {
      totalSessions += workspaces[key].sessions.length;
    }
    console.log(`  📊 Summary:`);
    console.log(`     Workspaces: ${workspaceKeys.length}`);
    console.log(`     Sessions:   ${totalSessions}`);
    console.log(`     File size:  ${(readFileSync(outputPath).length / 1024).toFixed(1)} KB\n`);
  } else {
    console.error(`❌ Validation failed with ${errors.length} error(s):\n`);
    for (const err of errors) {
      console.error(`  • [${err.path}] ${err.message}`);
    }
    console.error("");
    process.exit(1);
  }
}

function validateTraceOutput(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof data !== "object" || data === null) {
    errors.push({ path: "$", message: "Root must be an object" });
    return errors;
  }

  const root = data as Record<string, unknown>;

  // Check top-level fields
  if (!("workspace_count" in root)) {
    errors.push({ path: "$.workspace_count", message: "Missing required field 'workspace_count'" });
  } else if (typeof root.workspace_count !== "number") {
    errors.push({ path: "$.workspace_count", message: "'workspace_count' must be a number" });
  }

  if (!("workspaces" in root)) {
    errors.push({ path: "$.workspaces", message: "Missing required field 'workspaces'" });
    return errors;
  }

  if (typeof root.workspaces !== "object" || root.workspaces === null) {
    errors.push({ path: "$.workspaces", message: "'workspaces' must be an object" });
    return errors;
  }

  const workspaces = root.workspaces as Record<string, unknown>;
  const workspaceKeys = Object.keys(workspaces);

  if (workspaceKeys.length === 0) {
    errors.push({ path: "$.workspaces", message: "Must contain at least one workspace" });
    return errors;
  }

  for (const wsKey of workspaceKeys) {
    const ws = workspaces[wsKey] as Record<string, unknown>;
    const wsPath = `$.workspaces["${wsKey}"]`;

    if (!ws.workspacePath || typeof ws.workspacePath !== "string") {
      errors.push({ path: `${wsPath}.workspacePath`, message: "Missing or invalid 'workspacePath'" });
    }

    if (!Array.isArray(ws.sessions)) {
      errors.push({ path: `${wsPath}.sessions`, message: "'sessions' must be an array" });
      continue;
    }

    if (ws.sessions.length === 0) {
      errors.push({ path: `${wsPath}.sessions`, message: "Must contain at least one session" });
      continue;
    }

    for (let si = 0; si < ws.sessions.length; si++) {
      const session = ws.sessions[si] as Record<string, unknown>;
      const sPath = `${wsPath}.sessions[${si}]`;

      // Validate session wrapper
      if (typeof session.version !== "number") {
        errors.push({ path: `${sPath}.version`, message: "Missing or invalid 'version'" });
      }

      if (!session.data || typeof session.data !== "object") {
        errors.push({ path: `${sPath}.data`, message: "Missing or invalid 'data'" });
        continue;
      }

      const sessionData = session.data as Record<string, unknown>;

      // Validate session data
      for (const field of ["sessionId", "timestamp", "modelId"]) {
        if (!sessionData[field]) {
          errors.push({ path: `${sPath}.data.${field}`, message: `Missing required field '${field}'` });
        }
      }

      if (!Array.isArray(sessionData.requests)) {
        errors.push({ path: `${sPath}.data.requests`, message: "'requests' must be an array" });
        continue;
      }

      if (sessionData.requests.length === 0) {
        errors.push({ path: `${sPath}.data.requests`, message: "Must contain at least one request" });
        continue;
      }

      for (let ri = 0; ri < sessionData.requests.length; ri++) {
        const req = sessionData.requests[ri] as Record<string, unknown>;
        const rPath = `${sPath}.data.requests[${ri}]`;

        // Validate request fields
        for (const field of ["requestId", "responseId", "prompt", "response"]) {
          if (!req[field]) {
            errors.push({ path: `${rPath}.${field}`, message: `Missing required field '${field}'` });
          }
        }

        if (typeof req.prompt === "string" && req.prompt.trim().length === 0) {
          errors.push({ path: `${rPath}.prompt`, message: "Prompt must not be empty" });
        }

        if (typeof req.response === "string" && req.response.trim().length === 0) {
          errors.push({ path: `${rPath}.response`, message: "Response must not be empty" });
        }

        if (typeof req.latencyMs !== "number") {
          errors.push({ path: `${rPath}.latencyMs`, message: "Missing or invalid 'latencyMs'" });
        }
      }
    }
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────

validate();
