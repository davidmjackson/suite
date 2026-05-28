// lib/hub-api.js
export function createHubApi({ baseUrl, apiKey, fetchImpl = globalThis.fetch }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  return {
    async exchange(launchToken) {
      const res = await fetchImpl(`${baseUrl}/api/sessions/exchange`, {
        method: "POST",
        headers,
        body: JSON.stringify({ launch_token: launchToken }),
      });
      if (res.status !== 200) throw new Error(`exchange_failed:${res.status}`);
      return await res.json();
    },
    async heartbeat(centralSessionId) {
      try {
        const res = await fetchImpl(`${baseUrl}/api/sessions/${centralSessionId}/heartbeat`, {
          method: "POST", headers,
        });
        if (res.status === 200) return "ok";
        if (res.status === 404) return "expired";
        return "error";
      } catch {
        return "unreachable";
      }
    },
    async deleteSession(centralSessionId) {
      try {
        await fetchImpl(`${baseUrl}/api/sessions/${centralSessionId}`, { method: "DELETE", headers });
      } catch {}
    },
  };
}
