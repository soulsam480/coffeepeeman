const BAG_COLUMNS =
  "id, roaster, name, roast, price, grams, date, black, milk, note, created_at";
const CATALOG_COLUMNS =
  "id, roaster, name, roast, process, flavours, species, estate, region, price, grams, per100, url";
const EDITABLE_FIELDS = [
  "roaster",
  "name",
  "roast",
  "price",
  "grams",
  "date",
  "black",
  "milk",
  "note",
];
const BAG_PATH = /^\/api\/bags\/(\d+)$/;

export async function handleApi(request, env, owner) {
  const path = new URL(request.url).pathname;
  const method = request.method;

  if (path === "/api/me") return Response.json({ owner });
  if (path === "/api/bags" && method === "GET") return listBags(env);
  if (!owner) return unauthorized();

  if (path === "/api/catalog" && method === "GET") return listCatalog(env);
  if (path === "/api/bags" && method === "POST") return createBag(request, env);

  const id = bagIdFrom(path);
  if (id && method === "PATCH") return updateBag(request, env, id);
  if (id && method === "DELETE") return deleteBag(env, id);

  return notFound();
}

async function listBags(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${BAG_COLUMNS} FROM bags ORDER BY date DESC, id DESC`,
  ).all();
  return Response.json(results);
}

async function listCatalog(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${CATALOG_COLUMNS} FROM catalog ORDER BY per100`,
  ).all();
  return Response.json(results.map(parseCatalogRow));
}

function parseCatalogRow(row) {
  return {
    ...row,
    process: parseArray(row.process),
    flavours: parseArray(row.flavours),
    species: parseArray(row.species),
  };
}

function parseArray(value) {
  try {
    return JSON.parse(value || "[]");
  } catch {
    return [];
  }
}

async function createBag(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.roaster || !body?.name)
    return badRequest("roaster and name are required");

  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO bags (roaster, name, roast, price, grams, date, black, milk, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING ${BAG_COLUMNS}`,
  )
    .bind(
      body.roaster,
      body.name,
      body.roast || null,
      body.price ?? null,
      body.grams ?? null,
      body.date || now.slice(0, 10),
      body.black ?? null,
      body.milk ?? null,
      body.note || "",
      now,
    )
    .first();

  return Response.json(row, { status: 201 });
}

async function updateBag(request, env, id) {
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("expected a JSON body");

  const changes = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) changes[field] = body[field];
  }

  const fields = Object.keys(changes);
  if (!fields.length) return badRequest("nothing to update");

  const assignments = fields.map((field) => `${field} = ?`).join(", ");
  const values = fields.map((field) => changes[field]);

  const row = await env.DB.prepare(
    `UPDATE bags SET ${assignments} WHERE id = ? RETURNING ${BAG_COLUMNS}`,
  )
    .bind(...values, id)
    .first();

  return row ? Response.json(row) : notFound();
}

async function deleteBag(env, id) {
  const result = await env.DB.prepare("DELETE FROM bags WHERE id = ?")
    .bind(id)
    .run();
  return result.meta.changes ? new Response(null, { status: 204 }) : notFound();
}

function bagIdFrom(path) {
  const match = path.match(BAG_PATH);
  return match ? Number(match[1]) : null;
}

function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

function badRequest(message) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound() {
  return Response.json({ error: "not found" }, { status: 404 });
}
