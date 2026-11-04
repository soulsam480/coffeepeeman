const BAG_COLUMNS =
  "id, roaster, name, roast, price, grams, date, black, milk, note, flavours, process, created_at";
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
  "flavours",
  "process",
];
const ROASTS = new Set([
  "light",
  "light-medium",
  "medium",
  "medium-dark",
  "dark",
]);
const BAG_PATH = /^\/api\/bags\/(\d+)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT_LENGTH = 120;
const MAX_NOTE_LENGTH = 500;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;
const SCORE_MIN = 1;
const SCORE_MAX = 5;

export async function handleApi(request, env, owner) {
  const path = new URL(request.url).pathname;
  const method = request.method;

  if (path === "/api/me") return Response.json({ owner });
  if (path === "/api/bags" && method === "GET") return listBags(env);
  if (!owner) return unauthorized();

  if (path === "/api/catalog" && method === "GET") return listCatalog(env);

  const writesJson =
    method === "POST" || method === "PATCH" || method === "PUT";
  if (writesJson && !isJson(request)) return unsupportedMediaType();

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
  return Response.json(results.map(parseBagRow), {
    headers: { "cache-control": "no-store" },
  });
}

async function listCatalog(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${CATALOG_COLUMNS} FROM catalog ORDER BY per100`,
  ).all();
  return Response.json(results.map(parseCatalogRow), {
    headers: { "cache-control": "no-store" },
  });
}

function parseBagRow(row) {
  return {
    ...row,
    flavours: parseArray(row.flavours),
    process: parseArray(row.process),
  };
}

function parseCatalogRow(row) {
  return {
    ...row,
    url: safeUrl(row.url),
    process: parseArray(row.process),
    flavours: parseArray(row.flavours),
    species: parseArray(row.species),
  };
}

function safeUrl(value) {
  return typeof value === "string" && value.startsWith("https://")
    ? value
    : null;
}

function parseArray(value) {
  try {
    return JSON.parse(value || "[]");
  } catch {
    return [];
  }
}

async function createBag(request, env) {
  const { body, error } = await readJson(request);
  if (error) return badRequest(error);

  const problem = validateCreate(body);
  if (problem) return badRequest(problem);

  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO bags (roaster, name, roast, price, grams, date, black, milk, note, flavours, process, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING ${BAG_COLUMNS}`,
  )
    .bind(
      body.roaster.trim(),
      body.name.trim(),
      body.roast || null,
      body.price ?? null,
      body.grams ?? null,
      body.date || now.slice(0, 10),
      body.black ?? null,
      body.milk ?? null,
      body.note || "",
      JSON.stringify(sanitizeTags(body.flavours)),
      JSON.stringify(sanitizeTags(body.process)),
      now,
    )
    .first();

  return Response.json(parseBagRow(row), { status: 201 });
}

async function updateBag(request, env, id) {
  const { body, error } = await readJson(request);
  if (error) return badRequest(error);

  const problem = validateUpdate(body);
  if (problem) return badRequest(problem);

  const changes = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) {
      changes[field] =
        field === "flavours" || field === "process"
          ? JSON.stringify(sanitizeTags(body[field]))
          : body[field];
    }
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

  return row ? Response.json(parseBagRow(row)) : notFound();
}

async function deleteBag(env, id) {
  const result = await env.DB.prepare("DELETE FROM bags WHERE id = ?")
    .bind(id)
    .run();
  return result.meta.changes ? new Response(null, { status: 204 }) : notFound();
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return { error: "payload too large" };

  try {
    return { body: await request.json() };
  } catch {
    return { error: "expected JSON" };
  }
}

function isJson(request) {
  return (request.headers.get("content-type") || "").includes(
    "application/json",
  );
}

function isText(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_TEXT_LENGTH
  );
}

function isScore(value) {
  return (
    value === null ||
    value === undefined ||
    (Number.isInteger(value) && value >= SCORE_MIN && value <= SCORE_MAX)
  );
}

function isAmount(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function isRoast(value) {
  return (
    value === null || value === undefined || value === "" || ROASTS.has(value)
  );
}

function isNote(value) {
  return typeof value === "string" && value.length <= MAX_NOTE_LENGTH;
}

function isTags(value) {
  return (
    value === null ||
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= MAX_TAGS &&
      value.every(
        (tag) => typeof tag === "string" && tag.length <= MAX_TAG_LENGTH,
      ))
  );
}

function sanitizeTags(value) {
  return Array.isArray(value)
    ? value
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, MAX_TAGS)
    : [];
}

function validateCreate(body) {
  if (!body || typeof body !== "object") return "expected an object";
  if (!isText(body.roaster)) return "roaster is required";
  if (!isText(body.name)) return "name is required";
  if (!isRoast(body.roast)) return "invalid roast";
  if (!isScore(body.black) || !isScore(body.milk)) return "scores must be 1-5";
  if (!isAmount(body.price) || !isAmount(body.grams))
    return "invalid price or grams";
  if (body.date && !DATE_PATTERN.test(body.date)) return "invalid date";
  if (body.note && !isNote(body.note)) return "note is too long";
  if (!isTags(body.flavours)) return "invalid flavours";
  if (!isTags(body.process)) return "invalid process";
  return null;
}

function validateUpdate(body) {
  if (!body || typeof body !== "object") return "expected an object";
  if ("roaster" in body && !isText(body.roaster)) return "invalid roaster";
  if ("name" in body && !isText(body.name)) return "invalid name";
  if ("roast" in body && !isRoast(body.roast)) return "invalid roast";
  if ("black" in body && !isScore(body.black)) return "invalid black score";
  if ("milk" in body && !isScore(body.milk)) return "invalid milk score";
  if ("price" in body && !isAmount(body.price)) return "invalid price";
  if ("grams" in body && !isAmount(body.grams)) return "invalid grams";
  if ("date" in body && !DATE_PATTERN.test(body.date)) return "invalid date";
  if ("note" in body && !isNote(body.note)) return "note is too long";
  if ("flavours" in body && !isTags(body.flavours)) return "invalid flavours";
  if ("process" in body && !isTags(body.process)) return "invalid process";
  return null;
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

function unsupportedMediaType() {
  return Response.json(
    { error: "content-type must be application/json" },
    { status: 415 },
  );
}

function notFound() {
  return Response.json({ error: "not found" }, { status: 404 });
}
