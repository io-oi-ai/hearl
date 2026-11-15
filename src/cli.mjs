// hearl 命令行：登录、查看和处理收件箱、配置 MCP 客户端，以及给只支持 stdio 的客户端用的 MCP 桥接。
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { client } from "./api.mjs";
import { clearConfig, readConfig, saveConfig } from "./config.mjs";

const VERSION = "0.1.0";

const HELP = `hearl ${VERSION}: your product's X, Reddit and Hacker News inbox, from the terminal and from AI agents

Usage: hearl <command> [options]     (add --json to any command for raw JSON)

Account
  login [--token hl_...] [--url URL]    Save an API key (opens Agents & API in your browser)
  logout                                Forget the saved key
  status                                Show where you're connected

Inbox
  summary                               Needs action, unassigned, overdue, this week
  inbox [--view todo] [--product slug] [--platform x|reddit|hn] [--priority high] [--limit 20]
        views: todo, unassigned, mine, assisting, overdue, review, done, all
  show <id>                             Full post, replies, Jev's judgments, timeline
  products | members

Handle (needs a read-write key)
  assign <id> <email|me|none>           Give it an owner
  state <id> <open|in_progress|waiting_user|waiting_internal|done> [--outcome "..."]
  done <id> [--outcome "..."]           Same as: state <id> done
  due <id> <YYYY-MM-DD|none>            Set or clear the due date
  note <id> "text"                      Internal note, never posted publicly
  irrelevant <id>                       Close as not about the product

AI agents (MCP)
  mcp install [--client claude-code|cursor|claude-desktop]   Connect an MCP client
  mcp                                   Run a stdio MCP bridge to Hearl (for clients that only launch local servers)

Environment: HEARL_TOKEN, HEARL_URL`;

// 解析参数：--key value、--flag、位置参数
export function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      if (inline !== undefined) opt[k] = inline;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) opt[k] = argv[++i];
      else opt[k] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}

const out = (s = "") => process.stdout.write(s + "\n");
const PRI = { high: "!!", medium: "! ", low: "  " };
const ago = (iso) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const clip = (s, n) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

export function formatInbox(data) {
  if (!data.conversations.length) return `Nothing in "${data.view}".`;
  return data.conversations
    .map((c) => {
      const who = c.owner ? `@${c.owner.name ?? c.owner.email}` : "unassigned";
      const head = `${PRI[c.priority] ?? "  "} ${c.id}  ${c.platform.padEnd(6)} ${c.product}  ${ago(c.postedAt)}  ${c.state}  ${who}${c.dueAt ? `  due ${c.dueAt.slice(0, 10)}` : ""}`;
      return `${head}\n   ${clip(c.title || c.text, 110)}${c.url ? `\n   ${c.url}` : ""}`;
    })
    .join("\n");
}

export function formatConversation(c) {
  const lines = [
    `${c.title || clip(c.text, 80)}`,
    `${c.platform} · ${c.product} · ${c.author ?? "?"} · ${c.postedAt ?? ""}${c.url ? `\n${c.url}` : ""}`,
    "",
    c.text,
    "",
    `status: ${c.status ?? "-"}  priority: ${c.priority ?? "-"}  category: ${c.category ?? "-"}  state: ${c.state}`,
    `owner: ${c.owner ? (c.owner.name ?? c.owner.email) : "unassigned"}${c.dueAt ? `  due: ${c.dueAt.slice(0, 10)}` : ""}${c.outcome ? `  outcome: ${c.outcome}` : ""}`,
  ];
  // AI 判断：各项的概率（接口字段名仍叫 jev）
  const judged = c.jev && Object.entries(c.jev).filter(([, v]) => typeof v === "number");
  if (judged?.length) lines.push(`judgment: ${judged.map(([k, v]) => `${k.replace(/_/g, " ")} ${Math.round(v * 100)}%`).join(" · ")}`);
  if (c.replies?.length) {
    lines.push("", `replies (${c.replies.length}):`);
    for (const r of c.replies) lines.push(`  ${r.team ? "[team] " : ""}${r.author ?? "?"}: ${clip(r.text, 160)}`);
  }
  if (c.activity?.length) {
    lines.push("", "timeline:");
    for (const a of c.activity.slice(0, 10)) lines.push(`  ${a.at?.slice(0, 16).replace("T", " ")} ${a.by?.name ?? "?"}${a.via ? ` via ${a.via}` : ""}: ${a.kind}${a.to !== undefined ? ` → ${a.to}` : ""}${a.text ? ` "${clip(a.text, 80)}"` : ""}`);
  }
  return lines.join("\n");
}

function openBrowser(url) {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {}
}

// 读密钥：终端里不回显；管道输入直接读一行
async function askSecret(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
  if (process.stdin.isTTY) {
    rl._writeToOutput = (s) => {
      if (s.includes(prompt)) process.stderr.write(s);
    };
  }
  const answer = await new Promise((r) => rl.question(prompt, r));
  rl.close();
  if (process.stdin.isTTY) process.stderr.write("\n");
  return answer.trim();
}

async function login(opt) {
  const cfg = await readConfig();
  const url = (typeof opt.url === "string" ? opt.url : cfg.url).replace(/\/+$/, "");
  let token = typeof opt.token === "string" ? opt.token : null;
  if (!token) {
    const page = `${url}/app/agents`;
    process.stderr.write(`Create a key in Agents & API: ${page}\n`);
    if (process.stdin.isTTY) openBrowser(page);
    token = await askSecret("Paste the key (hl_...): ");
  }
  if (!token.startsWith("hl_")) throw new Error("that doesn't look like a Hearl key (they start with hl_)");
  const s = await client({ url, token }).summary();
  const path = await saveConfig({ url, token });
  out(`Logged in to ${url}. ${s.needsAction} conversations need action. Key saved to ${path}`);
}

// ---------- MCP ----------

const desktopConfigPath = () =>
  platform() === "darwin"
    ? join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")
    : platform() === "win32"
      ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
      : join(homedir(), ".config", "Claude", "claude_desktop_config.json");

async function mergeJson(path, fn) {
  let data = {};
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw new Error(`can't read ${path}: ${e.message}`);
  }
  fn(data);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

async function mcpInstall(opt) {
  const { url, token } = await readConfig();
  if (!token) throw new Error("run `hearl login` first");
  const endpoint = `${url}/mcp`;
  const which = opt.client;
  if (which === "claude-code") {
    const args = ["mcp", "add", "--transport", "http", "hearl", endpoint, "--header", `Authorization: Bearer ${token}`];
    const r = spawnSync("claude", args, { stdio: "inherit" });
    if (r.error) {
      out("Claude Code's `claude` command wasn't found. Run this instead:");
      out(`claude mcp add --transport http hearl ${endpoint} --header "Authorization: Bearer $HEARL_TOKEN"`);
      return 1;
    }
    return r.status ?? 0;
  }
  if (which === "cursor") {
    const path = join(homedir(), ".cursor", "mcp.json");
    await mergeJson(path, (d) => {
      d.mcpServers = { ...d.mcpServers, hearl: { url: endpoint, headers: { Authorization: `Bearer ${token}` } } };
    });
    out(`Added hearl to ${path}. Restart Cursor or reload MCP servers.`);
    return 0;
  }
  if (which === "claude-desktop") {
    const path = desktopConfigPath();
    await mergeJson(path, (d) => {
      d.mcpServers = { ...d.mcpServers, hearl: { command: "npx", args: ["-y", "hearl", "mcp"], env: { HEARL_TOKEN: token, HEARL_URL: url } } };
    });
    out(`Added hearl to ${path}. Restart Claude Desktop.`);
    return 0;
  }
  out(`Hearl MCP server: ${endpoint} (Streamable HTTP, header Authorization: Bearer <key>)

Claude Code     hearl mcp install --client claude-code
Cursor          hearl mcp install --client cursor
Claude Desktop  hearl mcp install --client claude-desktop
Other clients   point them at ${endpoint} with the Authorization header,
                or launch "npx -y hearl mcp" as a stdio server with HEARL_TOKEN set.`);
  return 0;
}

// stdio 桥接：每行一条 JSON-RPC 消息，转发到远程 /mcp，按顺序把回复写回 stdout
export async function mcpBridge({ url, token }, { input = process.stdin, output = process.stdout, fetchImpl = globalThis.fetch } = {}) {
  if (!token) throw new Error("set HEARL_TOKEN or run `hearl login`");
  const rl = createInterface({ input, crlfDelay: Infinity });
  let chain = Promise.resolve();
  const send = async (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      output.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n");
      return;
    }
    try {
      const res = await fetchImpl(`${url}/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(msg),
      });
      if (res.status === 202 || msg.id === undefined) return;
      const text = await res.text();
      output.write((text.trim() || JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: `HTTP ${res.status}` } })) + "\n");
    } catch (e) {
      if (msg.id !== undefined) output.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: e.message } }) + "\n");
    }
  };
  for await (const line of rl) {
    if (!line.trim()) continue;
    chain = chain.then(() => send(line));
  }
  await chain;
}

// ---------- 入口 ----------

export async function main(argv) {
  const { pos, opt } = parseArgs(argv);
  const [cmd, ...rest] = pos;
  if (!cmd || cmd === "help" || opt.help) return out(HELP), 0;
  if (cmd === "version" || opt.version) return out(VERSION), 0;
  if (cmd === "login") return login(opt).then(() => 0);
  if (cmd === "logout") return clearConfig().then(() => (out("Logged out."), 0));
  if (cmd === "mcp") return rest[0] === "install" ? mcpInstall(opt) : mcpBridge(await readConfig()).then(() => 0);

  const cfg = await readConfig();
  if (cmd === "status") {
    out(`${cfg.url} · ${cfg.token ? `key ${cfg.token.slice(0, 9)}… (${cfg.fromEnv ? "from HEARL_TOKEN" : "saved"})` : "not logged in"}`);
    return 0;
  }
  const api = client(cfg);
  const need = (v, what) => {
    if (!v) throw new Error(`missing ${what}; see \`hearl help\``);
    return v;
  };
  const print = (data, pretty) => out(opt.json ? JSON.stringify(data, null, 2) : pretty(data));

  switch (cmd) {
    case "summary":
      return print(await api.summary(), (s) =>
        [
          `needs action ${s.needsAction} · unassigned ${s.unassigned} · overdue ${s.overdue} · needs a check ${s.needsCheck}`,
          `this week: ${s.newThisWeek} new, ${s.doneThisWeek} done`,
          ...s.products.map((p) => `  ${p.slug.padEnd(20)} ${p.needsAction}`),
        ].join("\n"),
      ), 0;
    case "inbox":
      return print(await api.inbox({ view: opt.view, product: opt.product, platform: opt.platform, priority: opt.priority, limit: opt.limit }), formatInbox), 0;
    case "show":
      return print(await api.show(need(rest[0], "conversation id")), formatConversation), 0;
    case "products":
      return print(await api.products(), (d) => d.products.map((p) => `${p.slug.padEnd(20)} ${p.name}  (${p.needsAction} need action)`).join("\n") || "No products."), 0;
    case "members":
      return print(await api.members(), (d) => d.members.map((m) => `${m.email.padEnd(32)} ${m.name}  ${m.role}`).join("\n")), 0;
    case "assign": {
      const who = need(rest[1], "owner (email, me or none)");
      return print(await api.update(need(rest[0], "conversation id"), { owner: who === "none" ? null : who }), (c) => `${c.id} → ${c.owner ? (c.owner.name ?? c.owner.email) : "unassigned"} (${c.state})`), 0;
    }
    case "state":
    case "done": {
      const state = cmd === "done" ? "done" : need(rest[1], "state");
      return print(await api.update(need(rest[0], "conversation id"), { state, ...(typeof opt.outcome === "string" && { outcome: opt.outcome }) }), (c) => `${c.id} → ${c.state}${c.outcome ? ` (${c.outcome})` : ""}`), 0;
    }
    case "due": {
      const d = need(rest[1], "date (YYYY-MM-DD or none)");
      return print(await api.update(need(rest[0], "conversation id"), { due: d === "none" ? null : d }), (c) => `${c.id} due ${c.dueAt?.slice(0, 10) ?? "cleared"}`), 0;
    }
    case "note":
      return print(await api.note(need(rest[0], "conversation id"), need(rest.slice(1).join(" "), "note text")), () => "Note added."), 0;
    case "irrelevant":
      return print(await api.irrelevant(need(rest[0], "conversation id")), (r) => `Closed ${r.count} as not about the product.`), 0;
    default:
      out(`Unknown command "${cmd}".\n`);
      out(HELP);
      return 1;
  }
}
