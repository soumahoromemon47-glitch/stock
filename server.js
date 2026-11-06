import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import pool from "./db.js"; // <-- Import du pool PostgreSQL

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const uploadsDir = path.resolve("public", "uploads");
const allowedImageTypes = new Map([
  [
    "image/jpeg",
    {
      extension: ".jpg",
      signature: (header) =>
        header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
    },
  ],
  [
    "image/png",
    {
      extension: ".png",
      signature: (header) =>
        header
          .subarray(0, 8)
          .equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          ),
    },
  ],
  [
    "image/webp",
    {
      extension: ".webp",
      signature: (header) =>
        header.toString("ascii", 0, 4) === "RIFF" &&
        header.toString("ascii", 8, 12) === "WEBP",
    },
  ],
]);

mkdirSync(uploadsDir, { recursive: true });

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, callback) => {
      const imageType = allowedImageTypes.get(file.mimetype);
      callback(null, `${randomUUID()}${imageType.extension}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      callback(
        new Error("Format d'image non pris en charge (JPEG, PNG ou WebP)"),
      );
      return;
    }
    callback(null, true);
  },
});

function removeUploadedFile(filePath) {
  if (filePath) unlinkSync(filePath);
}

function removeProductImage(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith("/uploads/")) return;
  const filePath = path.join(uploadsDir, path.basename(imageUrl));
  try {
    unlinkSync(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function hasValidImageSignature(file) {
  const imageType = allowedImageTypes.get(file.mimetype);
  const header = readFileSync(file.path).subarray(0, 12);
  return imageType.signature(header);
}

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`,
    );
  });
  next();
});

app.use(express.static("public"));

function parsePagination(req) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function validateProduit(body) {
  const { reference, nom, prix_achat, prix_vente, seuil_alerte } = body;
  if (!reference || !String(reference).trim()) return "Référence requise";
  if (!nom || !String(nom).trim()) return "Nom requis";
  if (prix_achat != null && (isNaN(prix_achat) || Number(prix_achat) < 0))
    return "Prix d'achat invalide";
  if (prix_vente != null && (isNaN(prix_vente) || Number(prix_vente) < 0))
    return "Prix de vente invalide";
  if (
    seuil_alerte != null &&
    (!Number.isInteger(Number(seuil_alerte)) || Number(seuil_alerte) < 0)
  )
    return "Seuil d'alerte invalide";
  return null;
}

// ---------------- CATEGORIES ----------------

app.get("/api/categories", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM categories ORDER BY nom");
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});

app.post("/api/categories", async (req, res, next) => {
  const nom = (req.body.nom || "").trim();
  if (!nom) return res.status(400).json({ error: "Nom requis" });
  try {
    const result = await pool.query(
      "INSERT INTO categories (nom) VALUES ($1) RETURNING id, nom",
      [nom],
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    // En PostgreSQL, l'erreur de doublon (UNIQUE) a le code 23505
    if (e.code === "23505")
      return res.status(409).json({ error: "Cette catégorie existe déjà" });
    next(e);
  }
});

app.delete("/api/categories/:id", async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM categories WHERE id = $1", [
      req.params.id,
    ]);
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Catégorie introuvable" });
    res.json({ ok: true });
  } catch (e) {
    res
      .status(400)
      .json({ error: "Suppression impossible (catégorie utilisée)" });
  }
});

// ---------------- PRODUITS ----------------

app.get("/api/produits", async (req, res, next) => {
  const { page, pageSize, offset } = parsePagination(req);
  const search = (req.query.search || "").trim().toLowerCase();
  const categorie = req.query.categorie || "";
  const alertesOnly = req.query.alertes === "true";

  const where = [];
  const params = [];
  let paramIndex = 1;

  if (search) {
    where.push(
      `(LOWER(p.reference) LIKE $${paramIndex} OR LOWER(p.nom) LIKE $${paramIndex} OR LOWER(p.marque) LIKE $${paramIndex})`,
    );
    params.push(`%${search}%`);
    paramIndex++;
  }
  if (categorie) {
    where.push(`p.categorie_id = $${paramIndex}`);
    params.push(categorie);
    paramIndex++;
  }
  if (alertesOnly) {
    where.push("p.stock_actuel <= p.seuil_alerte");
  }

  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*) AS n FROM produits p LEFT JOIN categories c ON p.categorie_id = c.id ${whereSql}`,
      params,
    );
    const total = parseInt(countResult.rows[0].n, 10);

    const itemsParams = [...params, pageSize, offset];
    const itemsResult = await pool.query(
      `SELECT p.*, c.nom AS categorie FROM produits p LEFT JOIN categories c ON p.categorie_id = c.id ${whereSql} ORDER BY p.nom LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      itemsParams,
    );

    res.json({ items: itemsResult.rows, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

app.post(
  "/api/produits",
  imageUpload.single("image"),
  async (req, res, next) => {
    const err = validateProduit(req.body);
    if (err) {
      if (req.file) removeUploadedFile(req.file.path);
      return res.status(400).json({ error: err });
    }
    if (req.file && !hasValidImageSignature(req.file)) {
      removeUploadedFile(req.file.path);
      return res
        .status(400)
        .json({ error: "Le fichier ne semble pas être une image valide" });
    }
    const {
      reference,
      nom,
      marque,
      categorie_id,
      prix_achat,
      prix_vente,
      seuil_alerte,
    } = req.body;
    try {
      const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
      const result = await pool.query(
        `INSERT INTO produits (reference, nom, marque, categorie_id, prix_achat, prix_vente, seuil_alerte, image_url) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          String(reference).trim(),
          String(nom).trim(),
          marque || "",
          categorie_id || null,
          prix_achat || 0,
          prix_vente || 0,
          seuil_alerte ?? 1,
          imageUrl,
        ],
      );
      res.status(201).json({ id: result.rows[0].id });
    } catch (e) {
      if (req.file) removeUploadedFile(req.file.path);
      if (e.code === "23505")
        return res.status(409).json({ error: "Cette référence existe déjà" });
      next(e);
    }
  },
);

app.put(
  "/api/produits/:id",
  imageUpload.single("image"),
  async (req, res, next) => {
    const id = Number(req.params.id);
    const err = validateProduit(req.body);
    if (err) {
      if (req.file) removeUploadedFile(req.file.path);
      return res.status(400).json({ error: err });
    }
    const {
      reference,
      nom,
      marque,
      categorie_id,
      prix_achat,
      prix_vente,
      seuil_alerte,
    } = req.body;

    try {
      const existResult = await pool.query(
        "SELECT id, image_url FROM produits WHERE id = $1",
        [id],
      );
      const exist = existResult.rows[0];

      if (!exist) {
        if (req.file) removeUploadedFile(req.file.path);
        return res.status(404).json({ error: "Produit introuvable" });
      }
      if (req.file && !hasValidImageSignature(req.file)) {
        removeUploadedFile(req.file.path);
        return res
          .status(400)
          .json({ error: "Le fichier ne semble pas être une image valide" });
      }

      const imageUrl = req.file
        ? `/uploads/${req.file.filename}`
        : exist.image_url;

      await pool.query(
        `UPDATE produits SET reference = $1, nom = $2, marque = $3, categorie_id = $4, prix_achat = $5, prix_vente = $6, seuil_alerte = $7, image_url = $8 WHERE id = $9`,
        [
          String(reference).trim(),
          String(nom).trim(),
          marque || "",
          categorie_id || null,
          prix_achat || 0,
          prix_vente || 0,
          seuil_alerte ?? 1,
          imageUrl,
          id,
        ],
      );

      if (req.file) {
        try {
          removeProductImage(exist.image_url);
        } catch (error) {
          console.error(
            "Impossible de supprimer l'ancienne photo du produit",
            error,
          );
        }
      }
      res.json({ ok: true });
    } catch (e) {
      if (req.file) removeUploadedFile(req.file.path);
      if (e.code === "23505")
        return res.status(409).json({ error: "Cette référence existe déjà" });
      next(e);
    }
  },
);

app.delete("/api/produits/:id", async (req, res, next) => {
  try {
    const existResult = await pool.query(
      "SELECT image_url FROM produits WHERE id = $1",
      [req.params.id],
    );
    const produit = existResult.rows[0];

    const result = await pool.query("DELETE FROM produits WHERE id = $1", [
      req.params.id,
    ]);
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Produit introuvable" });

    if (produit && produit.image_url) {
      try {
        removeProductImage(produit.image_url);
      } catch (error) {
        console.error("Impossible de supprimer la photo du produit", error);
      }
    }
    return res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: "Suppression impossible" });
  }
});

// ---------------- MOUVEMENTS ----------------

app.get("/api/mouvements", async (req, res, next) => {
  const { page, pageSize, offset } = parsePagination(req);
  const type = req.query.type;
  const produitId = req.query.produit_id;
  const from = req.query.from;
  const to = req.query.to;
  const search = (req.query.search || "").trim().toLowerCase();

  const where = [];
  const params = [];
  let paramIndex = 1;

  if (type && ["ENTREE", "SORTIE"].includes(type)) {
    where.push(`m.type = $${paramIndex}`);
    params.push(type);
    paramIndex++;
  }
  if (produitId) {
    where.push(`m.produit_id = $${paramIndex}`);
    params.push(produitId);
    paramIndex++;
  }
  if (from) {
    where.push(`m.date >= $${paramIndex}`);
    params.push(from);
    paramIndex++;
  }
  if (to) {
    where.push(`m.date <= $${paramIndex}`);
    params.push(to);
    paramIndex++;
  }
  if (search) {
    where.push(
      `(LOWER(p.nom) LIKE $${paramIndex} OR LOWER(p.reference) LIKE $${paramIndex})`,
    );
    params.push(`%${search}%`);
    paramIndex++;
  }

  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*) AS n FROM mouvements m JOIN produits p ON p.id = m.produit_id ${whereSql}`,
      params,
    );
    const total = parseInt(countResult.rows[0].n, 10);

    const itemsParams = [...params, pageSize, offset];
    const itemsResult = await pool.query(
      `SELECT m.*, p.nom AS produit, p.reference FROM mouvements m JOIN produits p ON p.id = m.produit_id ${whereSql} ORDER BY m.date DESC, m.id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      itemsParams,
    );

    res.json({ items: itemsResult.rows, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

app.post("/api/mouvements", async (req, res, next) => {
  const { produit_id, type, quantite, motif } = req.body;
  const produitId = Number(produit_id);
  const q = Number(quantite);

  if (
    !Number.isSafeInteger(produitId) ||
    produitId <= 0 ||
    !["ENTREE", "SORTIE"].includes(type) ||
    !Number.isSafeInteger(q) ||
    q <= 0
  ) {
    return res
      .status(400)
      .json({ error: "Données invalides (quantité entière > 0)" });
  }

  // Transaction PostgreSQL sécurisée
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // FOR UPDATE est crucial ici pour éviter les conflits de stock
    const prodResult = await client.query(
      "SELECT stock_actuel FROM produits WHERE id = $1 FOR UPDATE",
      [produitId],
    );
    const produit = prodResult.rows[0];

    if (!produit) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Produit introuvable" });
    }
    if (type === "SORTIE" && produit.stock_actuel < q) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: `Stock insuffisant (dispo : ${produit.stock_actuel})` });
    }

    const nouveauStock =
      type === "ENTREE" ? produit.stock_actuel + q : produit.stock_actuel - q;
    if (!Number.isSafeInteger(nouveauStock)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Quantité de stock trop élevée" });
    }

    await client.query("UPDATE produits SET stock_actuel = $1 WHERE id = $2", [
      nouveauStock,
      produitId,
    ]);
    await client.query(
      "INSERT INTO mouvements (produit_id, type, quantite, motif, date) VALUES ($1, $2, $3, $4, $5)",
      [
        produitId,
        type,
        q,
        (motif || "").trim(),
        new Date().toISOString().slice(0, 10),
      ],
    );

    await client.query("COMMIT");
    res.json({ ok: true, stock_actuel: nouveauStock });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release(); // Toujours libérer la connexion !
  }
});

// ---------------- DASHBOARD & HEALTH ----------------

app.get("/api/dashboard", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM produits");
    const produits = result.rows;

    res.json({
      total: produits.length,
      totalStock: produits.reduce((s, p) => s + (p.stock_actuel || 0), 0),
      valeur: produits.reduce(
        (s, p) => s + (p.stock_actuel || 0) * (p.prix_achat || 0),
        0,
      ),
      alertes: produits.filter((p) => p.stock_actuel <= p.seuil_alerte),
    });
  } catch (e) {
    next(e);
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: NODE_ENV, time: new Date().toISOString() });
});

// ---------------- GESTION DES ERREURS ----------------

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res
      .status(status)
      .json({
        error:
          status === 413
            ? "Image trop volumineuse (maximum 5 Mo)"
            : "Téléversement invalide",
      });
  }
  if (err.message === "Format d'image non pris en charge (JPEG, PNG ou WebP)") {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: "Erreur serveur" });
});

app.listen(PORT, () =>
  console.log(`✅ http://localhost:${PORT} (${NODE_ENV})`),
);
