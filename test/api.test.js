import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { unlinkSync, existsSync, readFileSync } from "node:fs";

const PORT = 3099;
const DB_FILE = `test_${Date.now()}.db`;
let server;

test.before(async () => {
  server = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "test",
      DB_PATH: DB_FILE,
    },
    stdio: "ignore",
  });
  // wait for server
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`);
      if (r.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("server not ready");
});

test.after(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
  for (const file of [DB_FILE, DB_FILE + "-wal", DB_FILE + "-shm"]) {
    if (existsSync(file)) unlinkSync(file);
  }
});

async function api(path, options = {}) {
  const res = await fetch(`http://localhost:${PORT}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test("health", async () => {
  const { status, data } = await api("/api/health");
  assert.equal(status, 200);
  assert.equal(data.status, "ok");
});

test("categories CRUD", async () => {
  const create = await api("/api/categories", {
    method: "POST",
    body: JSON.stringify({ nom: "cat_test" }),
  });
  assert.equal(create.status, 201);
  const id = create.data.id;
  const del = await api(`/api/categories/${id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
});

test("produit validation rejects negative price", async () => {
  const res = await api("/api/produits", {
    method: "POST",
    body: JSON.stringify({
      reference: "ref_test",
      nom: "produit test",
      prix_achat: -5,
    }),
  });
  assert.equal(res.status, 400);
});

test("product image upload and replacement lifecycle", async () => {
  const form = new FormData();
  form.set("reference", "ref_image");
  form.set("nom", "produit image");
  form.set("prix_achat", "0");
  form.set("prix_vente", "0");
  form.set("seuil_alerte", "1");
  form.set(
    "image",
    new Blob(
      [
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=",
          "base64",
        ),
      ],
      { type: "image/png" },
    ),
    "product.png",
  );
  const create = await api("/api/produits", {
    method: "POST",
    headers: {},
    body: form,
  });
  assert.equal(create.status, 201);

  const products = await api("/api/produits?search=ref_image");
  assert.equal(products.data.items[0].reference, "ref_image");
  assert.equal(products.data.items[0].nom, "produit image");
  const imageUrl = products.data.items[0].image_url;
  assert.match(imageUrl, /^\/uploads\/[a-f0-9-]+\.png$/);
  assert.equal(
    (await fetch(`http://localhost:${PORT}${imageUrl}`)).status,
    200,
  );

  const jsonUpdated = await api(`/api/produits/${create.data.id}`, {
    method: "PUT",
    body: JSON.stringify({
      reference: "ref_image",
      nom: "produit image modifié",
      marque: "",
      categorie_id: "",
      prix_achat: "0",
      prix_vente: "0",
      seuil_alerte: "1",
    }),
  });
  assert.equal(jsonUpdated.status, 200);
  const jsonUpdatedProducts = await api("/api/produits?search=ref_image");
  assert.equal(jsonUpdatedProducts.data.items[0].nom, "produit image modifié");
  assert.equal(jsonUpdatedProducts.data.items[0].image_url, imageUrl);

  const emptyImageForm = new FormData();
  emptyImageForm.set("reference", "ref_image");
  emptyImageForm.set("nom", "produit image modifié");
  emptyImageForm.set("marque", "");
  emptyImageForm.set("categorie_id", "");
  emptyImageForm.set("prix_achat", "0");
  emptyImageForm.set("prix_vente", "0");
  emptyImageForm.set("seuil_alerte", "1");
  emptyImageForm.set(
    "image",
    new File([], "", { type: "application/octet-stream" }),
  );
  const emptyImageUpdate = await api(`/api/produits/${create.data.id}`, {
    method: "PUT",
    headers: {},
    body: emptyImageForm,
  });
  assert.equal(emptyImageUpdate.status, 200);
  assert.equal(
    (await fetch(`http://localhost:${PORT}${imageUrl}`)).status,
    200,
  );

  const replacement = new FormData();
  replacement.set("reference", "ref_image");
  replacement.set("nom", "produit image modifié");
  replacement.set("marque", "");
  replacement.set("categorie_id", "");
  replacement.set("prix_achat", "0");
  replacement.set("prix_vente", "0");
  replacement.set("seuil_alerte", "1");
  replacement.set(
    "image",
    new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
    "replacement.jpg",
  );
  const updated = await api(`/api/produits/${create.data.id}`, {
    method: "PUT",
    headers: {},
    body: replacement,
  });
  assert.equal(updated.status, 200);
  assert.equal(
    (await fetch(`http://localhost:${PORT}${imageUrl}`)).status,
    404,
  );
  const updatedProducts = await api("/api/produits?search=ref_image");
  const replacementUrl = updatedProducts.data.items[0].image_url;
  assert.match(replacementUrl, /\.jpg$/);

  const invalidForm = new FormData();
  invalidForm.set("reference", "ref_invalid_image");
  invalidForm.set("nom", "fichier invalide");
  invalidForm.set(
    "image",
    new Blob(["not an image"], { type: "image/png" }),
    "fake.png",
  );
  const invalid = await api("/api/produits", {
    method: "POST",
    headers: {},
    body: invalidForm,
  });
  assert.equal(invalid.status, 400);

  const del = await api(`/api/produits/${create.data.id}`, {
    method: "DELETE",
  });
  assert.equal(del.status, 200);
  assert.equal(
    (await fetch(`http://localhost:${PORT}${replacementUrl}`)).status,
    404,
  );
});

test("product can be edited with JSON or browser-style FormData without replacing its image", async () => {
  const create = await api("/api/produits", {
    method: "POST",
    body: JSON.stringify({ reference: "ref_edit_no_image", nom: "avant" }),
  });
  const imageForm = new FormData();
  imageForm.set("reference", "ref_edit_no_image");
  imageForm.set("nom", "avant");
  imageForm.set(
    "image",
    new Blob(
      [
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=",
          "base64",
        ),
      ],
      { type: "image/png" },
    ),
    "product.png",
  );
  assert.equal(
    (
      await api(`/api/produits/${create.data.id}`, {
        method: "PUT",
        headers: {},
        body: imageForm,
      })
    ).status,
    200,
  );

  const imageProducts = await api("/api/produits?search=ref_edit_no_image");
  const imageUrl = imageProducts.data.items[0].image_url;
  assert.ok(imageUrl);

  const jsonUpdated = await api(`/api/produits/${create.data.id}`, {
    method: "PUT",
    body: JSON.stringify({ reference: "ref_edit_no_image", nom: "après JSON" }),
  });
  assert.equal(jsonUpdated.status, 200);

  const form = new FormData();
  form.set("reference", "ref_edit_no_image");
  form.set("nom", "après FormData");
  form.set("marque", "");
  form.set("categorie_id", "");
  form.set("prix_achat", "0");
  form.set("prix_vente", "0");
  form.set("seuil_alerte", "1");
  form.set("image", new File([], "", { type: "application/octet-stream" }));
  const updated = await api(`/api/produits/${create.data.id}`, {
    method: "PUT",
    headers: {},
    body: form,
  });
  assert.equal(updated.status, 200);
  const products = await api("/api/produits?search=ref_edit_no_image");
  assert.equal(products.data.items[0].nom, "après FormData");
  assert.equal(products.data.items[0].image_url, imageUrl);
  assert.equal(
    (await fetch(`http://localhost:${PORT}${imageUrl}`)).status,
    200,
  );
  assert.equal(
    (await api(`/api/produits/${create.data.id}`, { method: "DELETE" })).status,
    200,
  );
  assert.equal(
    (await fetch(`http://localhost:${PORT}${imageUrl}`)).status,
    404,
  );
});

test("mouvement validation rejects zero quantity", async () => {
  // create product
  const p = await api("/api/produits", {
    method: "POST",
    body: JSON.stringify({ reference: "ref_mv", nom: "p mv" }),
  });
  const id = p.data.id;
  const m = await api("/api/mouvements", {
    method: "POST",
    body: JSON.stringify({ produit_id: id, type: "ENTREE", quantite: 0 }),
  });
  assert.equal(m.status, 400);
  // cleanup
  await api(`/api/produits/${id}`, { method: "DELETE" });
});

test("concurrent stock exits cannot oversell", async () => {
  const product = await api("/api/produits", {
    method: "POST",
    body: JSON.stringify({ reference: "ref_concurrent", nom: "p concurrent" }),
  });
  const id = product.data.id;
  assert.equal(product.status, 201);

  const entry = await api("/api/mouvements", {
    method: "POST",
    body: JSON.stringify({ produit_id: id, type: "ENTREE", quantite: 1 }),
  });
  assert.equal(entry.status, 200);

  const exits = await Promise.all([
    api("/api/mouvements", {
      method: "POST",
      body: JSON.stringify({ produit_id: id, type: "SORTIE", quantite: 1 }),
    }),
    api("/api/mouvements", {
      method: "POST",
      body: JSON.stringify({ produit_id: id, type: "SORTIE", quantite: 1 }),
    }),
  ]);
  assert.deepEqual(exits.map((result) => result.status).sort(), [200, 400]);

  const products = await api("/api/produits?search=ref_concurrent");
  assert.equal(products.data.items[0].stock_actuel, 0);
  const movements = await api(`/api/mouvements?produit_id=${id}`);
  assert.equal(movements.data.total, 2);
  await api(`/api/produits/${id}`, { method: "DELETE" });
});

test("pagination shape", async () => {
  const { status, data } = await api("/api/produits?page=1&pageSize=5");
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.items));
  assert.equal(typeof data.total, "number");
  assert.equal(data.page, 1);
});

test("edit form constraints match product validation", () => {
  const html = readFileSync(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  const editForm = html.split('<form id="form-edit">')[1].split("</form>")[0];
  assert.match(editForm, /name="reference" required/);
  assert.match(editForm, /name="nom" required/);
  for (const field of ["prix_achat", "prix_vente"]) {
    assert.match(
      editForm,
      new RegExp(
        `name="${field}"[\\s\\S]*?type="number"[\\s\\S]*?min="0"[\\s\\S]*?step="0\\.01"`,
      ),
    );
  }
  assert.match(editForm, /name="seuil_alerte" type="number" min="0"/);
});
