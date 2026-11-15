# hearl

Your product's X, Reddit and Hacker News inbox, from the terminal and from AI agents.

[Hearl](https://hearl.org) collects public posts about your product, has Jev (TypeSafe) judge which ones need a reply, and gives each one an owner, a due date and an outcome. This CLI reads and works that inbox, and connects MCP clients such as Claude Code, Cursor and Claude Desktop.

```bash
npx hearl login            # opens Agents & API, paste a key
npx hearl summary
npx hearl inbox --view unassigned --priority high
npx hearl show <id>
npx hearl assign <id> me
npx hearl done <id> --outcome "Replied with the 2.3.1 fix"
```

Every command takes `--json`. Writes need a read-write key; read-only keys can only look.

## MCP

The Hearl MCP server runs at `https://hearl.org/mcp` (Streamable HTTP, `Authorization: Bearer hl_...`).

```bash
npx hearl mcp install --client claude-code
npx hearl mcp install --client cursor
npx hearl mcp install --client claude-desktop
```

Clients that only start local servers can run the stdio bridge: `npx -y hearl mcp` with `HEARL_TOKEN` set.

Tools: `get_summary`, `list_conversations`, `get_conversation`, `list_products`, `list_members`, `assign_conversation`, `set_state`, `set_due_date`, `add_note`, `mark_irrelevant`. Prompts: `triage_inbox`, `draft_replies`, `weekly_report`.

Hearl never posts publicly. Agents leave draft replies as internal notes for a person to post.

## Configuration

The key is saved to `~/.config/hearl/config.json` (mode 600). `HEARL_TOKEN` and `HEARL_URL` override it.

## Agent skill

[`skills/hearl/SKILL.md`](skills/hearl/SKILL.md) teaches AI agents (Claude Code, Cursor, Codex and others) when and how to use Hearl: connecting, the MCP tools, and common triage workflows. Copy the `skills/hearl` folder into your agent's skills directory, or point it at <https://hearl.org/.well-known/agent-skills/hearl/SKILL.md>.

## Development

```bash
node --test src/*.test.mjs
```

No dependencies; Node 18+.

## License

MIT
