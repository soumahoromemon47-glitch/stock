import dotenv from "dotenv";
dotenv.config({ path: ".env.development.local" }); // Charge le fichier en local, l'ignore sur GitHub

import pg from "pg";
const { Pool } = pg;

// ... le reste de votre code ne change pas ...

// Utilise les variables d'environnement de Neon/Vercel
// (POSTGRES_URL ou DATABASE_URL selon ce qui est généré)
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Erreur inattendue sur le client Postgres", err);
});

export default pool;
