Start a new development session by creating a session file in
`.claude/sessions/` with the format `YYYY-MM-DD-HHMM-$ARGUMENTS.md` (or just
`YYYY-MM-DD-HHMM.md` if no name provided).

## Jira Integration (Enhanced Feature)

If a Jira task code is provided (e.g., `WUP-123`, `PROJ-456`), the command will:

1. **Check Jira MCP Availability**: Verify if
   `mcp__mcp-atlassian__jira_get_issue` tool is available
2. **Fetch Jira Task Details**: Retrieve task information including:
   - Title and description
   - Acceptance criteria
   - Task status and assignee
   - Labels and priority
3. **Create Git Branch**: Automatically create and checkout a new git branch:
   - Branch name format: `JIRA-CODE-kebab-case-title`
   - Example: `WUP-808-memory-and-session-continuity-issues`
   - Falls back to just the Jira code if title unavailable
4. **Auto-populate Session**: Create session file with Jira context:
   - Session name from Jira task title
   - Goals section populated from acceptance criteria
   - Overview includes task description and Jira link
   - Technical context from task details
   - Git branch information

**Usage Examples:**

- `/session-start WUP-123` - Creates session from Jira task WUP-123 + git branch
- `/session-start PROJ-456 custom-name` - Jira task + custom session name + git branch
- `/session-start my-feature` - Standard session creation (no Jira, no git branch)

## Standard Session Creation

The session file should begin with:

1. Session name and timestamp as the title
2. Session overview section with start time
3. Goals section (ask user for goals if not clear, or auto-populated from Jira)
4. Empty progress section ready for updates
5. **Jira Context** section (if applicable) with:
   - Original task link
   - Task description
   - Acceptance criteria
   - Current status
   - Git branch name created

## Implementation Logic

```
1. Parse arguments for Jira task code pattern (e.g., ABC-123)
2. If Jira code detected:
   - Check if mcp__mcp-atlassian__jira_get_issue is available
   - Fetch task details using jira_get_issue tool
   - Check current git branch name
   - Create git branch with format: JIRA-CODE-kebab-case-title (only if on standard branch)
     * Convert title to kebab-case (lowercase, spaces to hyphens)
     * Remove special characters except hyphens
     * Limit length to reasonable git branch name
     * Example: "WUP-808-memory-and-session-continuity-issues"
   - Smart branch switching:
     * Switch if current branch is: main, main-test, dev, staging, master, develop
     * Stay on current branch if it's a custom/feature branch
   - Generate session file with Jira context
   - Use task title as session name (fallback to code if title unavailable)
3. If no Jira code or MCP unavailable:
   - Create standard session file
   - Ask user for goals if not provided
   - No git branch creation
4. Create/update .current-session file
5. Confirm session start with appropriate context (including branch name if created)
```

## Git Branch Management

When creating a git branch from Jira task:

1. **Branch Naming Convention**:

   - Format: `JIRA-CODE-kebab-case-title`
   - Convert spaces to hyphens, remove special chars
   - Lowercase everything except the Jira code
   - Truncate long titles to keep branch name reasonable

2. **Git Operations**:

   - Check current branch name
   - **Smart Branch Switching**:
     - Switch to new branch if current branch is: `main`, `main-test`, `dev`, `staging`, `master`, `develop`
     - Stay on current branch if it's a custom/feature branch (e.g., `bugfix-dynamic-intro`)
     - Use `git checkout -b BRANCH-NAME` for standard branches
     - Skip branch creation but continue session for custom branches
   - Check if target branch already exists (warn if it does)

3. **Branch Detection Logic**:

   - **Standard branches** (will switch): `main`, `main-test`, `dev`, `staging`, `master`, `develop`
   - **Custom branches** (will stay): Any branch with prefixes like `feature/`, `bugfix/`, `hotfix/`, or custom names like `bugfix-dynamic-intro`

4. **Error Handling**:
   - If git command fails, continue with session creation but warn user
   - If Jira task fetch fails, ask user if they want to create branch manually
   - If on custom branch, inform user that branch creation was skipped

After creating the file, create or update `.claude/sessions/.current-session` to
track the active session filename.

Confirm the session has started and remind the user they can:

- Update it with `/project:session-update`
- End it with `/project:session-end`
- Switch back to previous branch when session ends (if desired)
