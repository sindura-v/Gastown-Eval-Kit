# Gastown Eval Kit

Automated eval runner for the Gastown DS/ML Standards hackathon. Sends all Fuel Rod questions to your GitHub Copilot custom agent, captures responses, and generates a `ghcp_eval_traces.json` file ready to upload to the leaderboard.

---

## Quick Start

### 1. Unzip and open in VS Code

You downloaded this kit from **Step A** of the Submit Run modal on the Gastown leaderboard. Unzip it, then open the folder in VS Code:

```bash
code gastown-eval-kit
```

When VS Code opens, you'll see a popup: **"Reopen in Container"** → click it. Wait ~60 seconds for the container to build.

> If the popup doesn't appear, press `Ctrl+Shift+P` → type "Reopen in Container" → Enter.

If you can't use Docker (locked-down machine, etc.), see [Running without containers](#running-without-containers) below.

### 2. Write your agent's skill

Open `.github/skills/data-science-standards/SKILL.md`. **This file is your agent.** It's where you encode your team's approach to answering the Fuel Rod DS/ML standards questions — anything from a short list of principles to a detailed reasoning framework.

This is the actual hackathon work. The kit ships with a starter template — replace it with your team's content.

### 3. Configure

Open `config.yaml` and set the model (and anything else you want to override — defaults are sensible):

```yaml
agent:
  prompt_path: "auto"  # Leave as "auto" if your skill lives in .github/skills/
  skills_dir: ".github/skills/data-science-standards"

model:
  name: "gpt-5.3-codex"  # Or: gpt-4.1, claude-sonnet-4
```

### 4. Run

Press **`Ctrl+Shift+B`** (the default build shortcut), or run in the terminal:

```bash
npm run eval
```

> **First run on macOS:** A dialog will pop up asking for permission to access the keychain (Copilot needs this for auth). Enter your password, click **"Always Allow"**, then press `Ctrl+C` and re-run `npm run eval`. Subsequent runs go through without interruption.

You'll see progress in the terminal:

```
🚀 Gastown Eval Kit

  Model:     gpt-5.3-codex
  Questions: questions.csv
  Output:    ghcp_eval_traces.json
  Retries:   2

  Loaded 50 questions

────────────────────────────────────────────────────────────

  [1/50] What should a PR review checklist include for...
  ✅ 1432ms | category: code_quality

  [2/50] How should we version control feature engine...
  ✅ 987ms | category: code_quality
```

When done, upload `ghcp_eval_traces.json` via **Step B** of the Submit Run modal on the leaderboard.

---

## Prerequisites

### Using the Dev Container (recommended)

| Requirement | Why |
|---|---|
| VS Code | The editor |
| Docker Desktop | Runs the Dev Container — install from docker.com |
| Dev Containers extension | VS Code prompts you to install it on first open |
| GitHub Copilot licence | Required to call the Copilot API |
| Signed into GitHub in VS Code | So Copilot auth is forwarded into the container |

> **You do NOT need** Node.js, npm, TypeScript, or any other dev tools installed on your laptop — the container provides everything.

### Running without containers

If Docker isn't available on your machine, you can run the kit directly on your laptop. You'll need to provision the tools yourself.

```bash
# 1. Install Node.js 18+ from https://nodejs.org/en/download

# 2. Install tsx globally
sudo npm install -g tsx

# 3. Install the GitHub CLI
brew install gh   # macOS
# …or get the Windows/Linux installer from https://cli.github.com/

# 4. Install the Copilot CLI (needed for auth)
npm install -g @github/copilot

# 5. Authenticate Copilot
npx @github/copilot
# Then at the prompt:
#   /login
#   Select "1" for GitHub.com login and follow the on-screen instructions
#   /quit
```


## Configuration Reference

All settings live in `config.yaml`:

| Setting | Default | Description |
|---|---|---|
| `agent.prompt_path` | `auto` | Path to your agent prompt; `auto` detects from the workspace |
| `agent.skills_dir` | `.github/skills/data-science-standards` | Where your skill files live |
| `model.name` | `gpt-5.3-codex` | Copilot model to use |
| `questions.csv_path` | `questions.csv` | Questions CSV file |
| `execution.timeout_seconds` | `120` | Max time per question |
| `execution.retries` | `2` | Retries on failure |
| `execution.retry_delay_ms` | `3000` | Pause between retries |
| `execution.save_partial` | `true` | Keep partial results if the run is interrupted |
| `output.file` | `ghcp_eval_traces.json` | Output filename |
| `output.validate` | `true` | Validate output against the leaderboard schema |

---

## Troubleshooting

### "Reopen in Container" doesn't appear

Install the **Dev Containers** extension (`ms-vscode-remote.remote-containers`) and make sure Docker Desktop is running.

### Copilot authentication errors

Check you're signed into GitHub in VS Code (account icon, bottom-left). If you are, try signing out and back in.

### Timeouts on questions

Increase `execution.timeout_seconds` in `config.yaml`. The default 120s suits most agents; complex ones may need 180–240s.

### Run was interrupted

Check for `ghcp_eval_traces.partial.json` in the kit folder. It contains all successfully completed questions up to the failure point.

---

## Project Structure

```
gastown-eval-kit/
├── .devcontainer/
│   └── devcontainer.json    # Container config (don't edit)
├── .github/skills/
│   └── data-science-standards/
│       └── SKILL.md         # ⭐ Your agent — edit this
├── .vscode/
│   └── tasks.json           # Build task (Ctrl+Shift+B)
├── .gitignore
├── auto_eval.ts             # Eval runner (don't edit)
├── config.yaml              # ⭐ Your settings
├── package.json
├── questions.csv            # Fuel Rod questions
├── tsconfig.json
├── validate_output.ts       # Output validator
└── README.md
```

---

## For Developers

### Validating output manually

```bash
npm run validate
```

### Adding custom questions

Edit `questions.csv`. Format: `question,category`.
