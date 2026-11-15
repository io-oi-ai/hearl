import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { formatConversation, formatInbox, mcpBridge, parseArgs } from "./cli.mjs";
import { client } from "./api.mjs";

test("parseArgs 支持 --k v、--k=v 和开关", () => {
  assert.deepEqual(parseArgs(["inbox", "--view", "mine", "--limit=5", "--json"]), { pos: ["inbox"], opt: { view: "mine", limit: "5", json: true } });
});

test("client 带上令牌和 CLI 标记，错误时抛出服务器的信息", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ error: "this token is read-only" }), { status: 403 });
  };
  await assert.rejects(client({ url: "https://h.test", token: "hl_x" }, fake).update("c1", { state: "done" }), /read-only/);
  assert.equal(calls[0].url, "https://h.test/api/v1/conversations/c1");
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[0].init.headers.authorization, "Bearer hl_x");
  assert.equal(calls[0].init.headers["x-hearloop-client"], "cli");
});

test("inbox 查询参数会去掉空值", async () => {
  let seen;
  const fake = async (url) => ((seen = url), new Response('{"view":"todo","conversations":[]}'));
  await client({ url: "https://h.test", token: "hl_x" }, fake).inbox({ view: "todo", product: undefined, limit: 5 });
  assert.equal(seen, "https://h.test/api/v1/conversations?view=todo&limit=5");
});

test("formatInbox 空列表和一条记录", () => {
  assert.match(formatInbox({ view: "mine", conversations: [] }), /Nothing in "mine"/);
  const s = formatInbox({
    view: "todo",
    conversations: [{ id: "c1", platform: "reddit", product: "app", postedAt: new Date().toISOString(), state: "open", owner: null, priority: "high", title: "Sync broke", url: "https://r/x" }],
  });
  assert.match(s, /!! c1 {2}reddit/);
  assert.match(s, /unassigned/);
});

test("MCP 桥接按顺序转发，通知不回写", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on("data", (c) => chunks.push(String(c)));
  const fake = async (_url, init) => {
    const msg = JSON.parse(init.body);
    if (msg.id === undefined) return new Response(null, { status: 202 });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echo: msg.method } }));
  };
  const done = mcpBridge({ url: "https://h.test", token: "hl_x" }, { input, output, fetchImpl: fake });
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  input.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
  input.end();
  await done;
  const lines = chunks.join("").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.id), [1, 2]);
  assert.equal(lines[1].result.echo, "tools/list");
});

test("formatConversation 显示判断概率和时间线", () => {
  const s = formatConversation({
    id: "c1", platform: "x", product: "app", author: "u", postedAt: "2026-11-10T00:00:00Z", text: "fee too high", state: "open",
    status: "no_reply_yet", priority: "high", category: "pricing", owner: null,
    jev: { relevant: 0.98, needs_reply: 0.9 },
    activity: [{ kind: "note", at: "2026-11-10T15:16:37Z", by: { name: "Z" }, via: "api", text: "draft" }],
  });
  assert.match(s, /judgment: relevant 98% · needs reply 90%/);
  assert.match(s, /timeline:\n.*note "draft"/);
});
