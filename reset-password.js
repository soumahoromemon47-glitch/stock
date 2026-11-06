import pg from "pg";
import fs from "node:fs";
import dotenv from "dotenv";

// Charge les variables depuis le fichier local
dotenv.config({ path: ".env.development.local" });

const pool = new pg.Pool({
  connectionString: process.env.POSTGRES_URL,
});

const nouveauMotDePasse = "Soum123654@"; // <--- Choisissez un mot de passe fort ici

async function reset() {
  try {
    console.log("Tentative de changement de mot de passe...");
    // Remplacez 'neondb_owner' par votre rôle si différent
    await pool.query(
      `ALTER USER neondb_owner WITH PASSWORD '${nouveauMotDePasse}';`,
    );
    console.log("✅ Mot de passe changé avec succès !");
    console.log("👉 Nouveau mot de passe :", nouveauMotDePasse);
  } catch (err) {
    console.error("❌ Erreur :", err.message);
  } finally {
    await pool.end();
    
  }
}

reset();
