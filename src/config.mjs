// 本地配置：~/.config/hearl/config.json（权限 600）。环境变量 HEARL_TOKEN、HEARL_URL 优先；
// 改名前的 HEARLOOP_TOKEN、HEARLOOP_URL 和 ~/.config/hearl/config.json 仍然认。
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_URL = "https://hearl.org";

const configDir = () => process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
export const configPath = () => join(configDir(), "hearl", "config.json");
const legacyPath = () => join(configDir(), "hearloop", "config.json");

export async function readConfig() {
  let file = {};
  for (const p of [configPath(), legacyPath()]) {
    try {
      file = JSON.parse(await readFile(p, "utf8"));
      break;
    } catch {}
  }
  const envToken = process.env.HEARL_TOKEN || process.env.HEARLOOP_TOKEN;
  return {
    url: (process.env.HEARL_URL || process.env.HEARLOOP_URL || file.url || DEFAULT_URL).replace(/\/+$/, ""),
    token: envToken || file.token || null,
    fromEnv: Boolean(envToken),
  };
}

export async function saveConfig(cfg) {
  const p = configPath();
  await mkdir(join(p, ".."), { recursive: true, mode: 0o700 });
  await writeFile(p, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  return p;
}

export async function clearConfig() {
  await rm(configPath(), { force: true });
}
