---
name: hearl
description: Work a team's Hearl inbox of public posts, app reviews and GitHub issues about their product (X, Reddit, Hacker News, Xiaohongshu, Weibo, Zhihu, Bilibili, YouTube, App Store, Google Play, GitHub). Use when the user mentions Hearl, asks what people are saying about their product, wants to triage or assign mentions, draft replies to posts, check what's overdue, or write a report on community feedback.
---

# Hearl

Hearl is a shared inbox for public conversations about a product. It collects posts and replies from X, Reddit, Hacker News, Xiaohongshu, Weibo, Zhihu, Bilibili, YouTube, App Store and Google Play reviews, and GitHub issues; Hearl's AI judges whether each one is about the product, whether it needs a reply and how urgent it is (with probabilities), and the team gives each conversation one owner, a due date and an outcome. Hearl never posts publicly; people post replies themselves.

## Connect

You need a workspace API key (`hl_...`). The user creates it in the workspace under **Agents & API** (https://hearl.org/app/agents) and chooses read-only or read-write. Keep it in the `HEARL_TOKEN` environment variable; never print it or commit it.

Pick one:

- **MCP** (Streamable HTTP): https://hearl.org/mcp
  - Claude Code: `claude mcp add --transport http hearl https://hearl.org/mcp --header "Authorization: Bearer $HEARL_TOKEN"`
  - Any client: `npx hearl mcp install`, or add this to the client's MCP config:
```json
{
  "mcpServers": {
    "hearl": {
      "type": "http",
      "url": "https://hearl.org/mcp",
      "headers": {
        "Authorization": "Bearer ${HEARL_TOKEN}"
      }
    }
  }
}
```
- **CLI**: `npx hearl login`, then `npx hearl inbox`. Every command accepts `--json`.
- **REST**: https://hearl.org/api/v1 with `Authorization: Bearer hl_...`. OpenAPI: https://hearl.org/api/v1/openapi.json

### REST quick reference

| Call | What it does |
| --- | --- |
| `GET /summary` | Counts: needs action, unassigned, overdue, needs a check, new and done this week, per product and platform |
| `GET /conversations?view=todo&product=<slug>&platform=<platform>&priority=high&limit=20` | Inbox list, most urgent first (all parameters optional; limit 1-100). Each item has `postedAt`; filter by date yourself, e.g. "this week" |
| `GET /conversations/{id}` | Full post, replies, the AI judgment with probabilities (field `jev`), team replies, owner, due date, outcome and `activity` timeline |
| `PATCH /conversations/{id}` | Any of `{"owner": "me"|email|null, "collaborators": [...], "state": "...", "outcome": "...", "due": "2026-11-20"|null}`. Unknown fields return 400 |
| `POST /conversations/{id}/notes` | `{"text": "..."}`: internal note, never posted publicly |
| `POST /conversations/{id}/irrelevant` | Close as not about the product |
| `GET /products`, `GET /members` | Product slugs and member ids/emails |

The list returns status, priority and category; call `GET /conversations/{id}` when you need the probabilities.

## Tools

The MCP tools, CLI commands and REST endpoints are the same operations. Read-only keys only see the read tools.

| Tool | Access | What it does |
| --- | --- | --- |
| `get_summary` | read | Counts of conversations that need action, are unassigned, overdue or need a human check, plus new and closed this week, split by product and platform. Start here to see how the team is doing. |
| `list_conversations` | read | List posts and threads from X, Reddit, Hacker News and the other connected channels in a view of the shared inbox, most urgent first. Views: todo (needs action or in progress), unassigned, mine, assisting, overdue, review (the AI was unsure), done, all. Each item has postedAt for date filtering; own_post means the team's own post. |
| `get_conversation` | read | Full post with its replies, the thread it answers, the AI judgment with probabilities, whether the team already replied, owner, collaborators, due date, outcome and the activity timeline. Use it before drafting a reply or deciding who should own it. |
| `list_products` | read | Products this workspace tracks, with how many conversations need action for each. |
| `list_members` | read | Workspace members with id, name, email and role. Use the email or id to assign conversations. |
| `assign_conversation` | write | Give a conversation one owner: a member id, their email, "me" (the person who created this token) or null to unassign. An unstarted conversation moves to in_progress. |
| `set_state` | write | Move a conversation through the workflow: open, in_progress, waiting_user, waiting_internal or done. When marking done, record the outcome in a sentence (what was replied, fixed or decided). |
| `set_due_date` | write | Set when the conversation should be handled by (ISO date or datetime), or null to clear it. Overdue ones show up in the overdue view. |
| `add_note` | write | Add a note to the conversation's timeline, visible only to the team inside Hearl (never posted publicly). Use @name to mention a member. Good for leaving a draft reply, a summary or a hand-off. |
| `mark_irrelevant` | write | Close a conversation that isn't about the product and record it as filtering feedback. It leaves the inbox; it can be reopened with set_state. Confirm with the user before closing many. |

Inbox views: todo, unassigned, mine, assisting, overdue, review, done, all. States (set by the team): open, in_progress, waiting_user, waiting_internal, done.

Platform status (`status`, read from the thread by Hearl, not set by people):

| Status | Meaning |
| --- | --- |
| `no_reply_yet` | Someone posted and the team hasn't answered: usually the one to act on |
| `user_followed_up` | The team replied, then the user wrote again |
| `team_replied` | One of the team's accounts answered last |
| `own_post` | Posted by the team's own official account; only needs attention when others reply to it |
| `no_reply_needed` | About the product but nothing to answer (e.g. praise) |
| `needs_check` | The AI wasn't sure it's about the product; a person should decide (view `review`) |
| `irrelevant` | Not about the product |
| `not_tracked` | Older than the tracking window; no longer rechecked |

Platform ids: x, reddit, hn, xiaohongshu, weibo, zhihu, bilibili, youtube, app_store, google_play, github.

## Before you start

Ask the user what is still unclear before reading or changing anything: which product (if the workspace has several), which view or time range ("this week", "overdue"), whether they want a summary, a list or changes applied, and who should own new work. Read first; change owners, states or due dates only after they agree.

## When something goes wrong

- `401`: the key is missing, wrong or revoked; ask the user to create a new one under Agents & API.
- `403`: the key is read-only; ask for a read-write key or tell the user what you would have changed.
- `400`: a field or value is wrong; the error names it. Fix it and retry once.
- `429` or `5xx`: wait a little and retry once; if it keeps failing, check https://hearl.org/status (or https://hearl.org/api/status, no key needed) and tell the user.
- An empty inbox may mean collection has not run yet for a new product; it runs on the plan's schedule.

## Workflows

**Triage.** `get_summary` → `list_conversations` (view `unassigned`) → `get_conversation` where the preview isn't enough → propose owner, due date, or irrelevant for each → ask the user → apply with `assign_conversation`, `set_due_date`, `mark_irrelevant`.

**Draft replies.** `list_conversations` (view `todo`, priority `high`), skip status `team_replied` → `get_conversation` → draft a short reply in the post's language → after the user approves, save it with `add_note` ("Draft reply: ...") and assign to `me`. Don't claim you posted it.

**Follow-ups.** View `todo` with status `user_followed_up` means the user wrote back after the team replied; summarize what changed and who owns it.

**Report.** `get_summary` plus the most important conversations from view `all`: top requests and complaints with links, what was resolved, what's open or overdue and who owns it.

## Rules

- Ask before closing or reassigning more than a few conversations.
- When marking `done`, write the outcome in one sentence.
- Link to the original post (`url`) when you mention one.
- Collection status per channel is public at https://hearl.org/status. Collecting runs on Hearl's schedule (daily on Free, hourly on paid plans, every 15 minutes for fast products on Enterprise); you don't need to push data. Teams with their own collector can push threads with `POST /products/{slug}/threads`.

Plans: Free $0, Individual $19/month, Team $15/seat/month, Enterprise $299/month; extra conversations are billed by usage (https://hearl.org/pricing.md). Docs: https://hearl.org/docs
