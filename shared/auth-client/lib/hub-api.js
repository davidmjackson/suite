// lib/hub-api.js
function createHubApi({ baseUrl, apiKey, appName, fetchImpl = globalThis.fetch }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  return {
    async exchange(launchToken) {
      const res = await fetchImpl(`${baseUrl}/api/sessions/exchange`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ launch_token: launchToken }),
      });
      if (res.status !== 200) throw new Error(`exchange_failed:${res.status}`);
      return await res.json();
    },
    async heartbeat(centralSessionId) {
      try {
        const res = await fetchImpl(`${baseUrl}/api/sessions/${centralSessionId}/heartbeat`, {
          method: 'POST',
          headers,
        });
        if (res.status === 200) return 'ok';
        if (res.status === 404) return 'expired';
        return 'error';
      } catch {
        return 'unreachable';
      }
    },
    async consume(centralSessionId) {
      try {
        const res = await fetchImpl(`${baseUrl}/api/apps/${appName}/consume`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ central_session_id: centralSessionId }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 200) return { ok: true, remaining: body.remaining ?? null };
        if (res.status === 402) return { ok: false, reason: 'quota_exceeded' };
        if (res.status === 403) return { ok: false, reason: body.reason || 'not_entitled' };
        return { ok: false, reason: 'error' };
      } catch {
        return { ok: false, reason: 'unreachable' };
      }
    },
    async deleteSession(centralSessionId) {
      try {
        await fetchImpl(`${baseUrl}/api/sessions/${centralSessionId}`, {
          method: 'DELETE',
          headers,
        });
      } catch {}
    },
  };
}

module.exports = { createHubApi };
