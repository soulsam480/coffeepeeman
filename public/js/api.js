async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    ...options,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }

  return response.status === 204 ? null : response.json();
}

export const getMe = () => request("/api/me");
export const getBags = () => request("/api/bags");
export const getCatalog = () => request("/api/catalog");

export const addBag = (bag) =>
  request("/api/bags", { method: "POST", body: JSON.stringify(bag) });

export const updateBag = (id, changes) =>
  request(`/api/bags/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
