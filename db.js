import { Database } from "node:sqlite";

const dbPath = process.env.DB_PATH || "stock.db";
const db = new Database(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS produits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT UNIQUE,
    nom TEXT NOT NULL,
    marque TEXT,
    categorie_id INTEGER,
    prix_achat REAL DEFAULT 0,
    prix_vente REAL DEFAULT 0,
    seuil_alerte INTEGER DEFAULT 1,
    stock_actuel INTEGER DEFAULT 0,
    image_url TEXT,
    FOREIGN KEY (categorie_id) REFERENCES categories(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS mouvements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produit_id INTEGER NOT NULL,
    type TEXT CHECK(type IN ('ENTREE','SORTIE')),
    quantite INTEGER NOT NULL,
    motif TEXT,
    date TEXT NOT NULL,
    FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
  );
`);

const produitColumns = db.prepare("PRAGMA table_info(produits)").all();
if (!produitColumns.some((column) => column.name === "image_url")) {
  db.exec("ALTER TABLE produits ADD COLUMN image_url TEXT");
}

export default db;
