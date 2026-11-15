// REST 客户端：所有命令都走 /api/v1，带上 x-hearloop-client: cli，时间线上显示为“通过 CLI”
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function client({ url, token }, fetchImpl = globalThis.fetch) {
  async function call(method, path, body) {
    if (!token) throw new ApiError(401, "not logged in; run `hearl login` or set HEARL_TOKEN");
    const res = await fetchImpl(`${url}/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "x-hearloop-client": "cli", ...(body && { "content-type": "application/json" }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text };
    }
    if (!res.ok) throw new ApiError(res.status, data.error || `HTTP ${res.status}`);
    return data;
  }
  const qs = (o) => {
    const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== ""));
    return p.size ? `?${p}` : "";
  };
  return {
    summary: () => call("GET", "/summary"),
    products: () => call("GET", "/products"),
    members: () => call("GET", "/members"),
    inbox: (o = {}) => call("GET", `/conversations${qs(o)}`),
    show: (id) => call("GET", `/conversations/${encodeURIComponent(id)}`),
    update: (id, patch) => call("PATCH", `/conversations/${encodeURIComponent(id)}`, patch),
    note: (id, text) => call("POST", `/conversations/${encodeURIComponent(id)}/notes`, { text }),
    irrelevant: (id) => call("POST", `/conversations/${encodeURIComponent(id)}/irrelevant`),
  };
}
