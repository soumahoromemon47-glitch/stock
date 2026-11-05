# Stock Informatique

Application web locale de gestion de stock de matériel informatique.

## Prérequis

- Node.js >= 22 (utilise le module natif `node:sqlite`)

## Installation

```bash
npm install
```

## Démarrage

```bash
npm start
```

Puis ouvrir http://localhost:3000

## Fonctionnalités

- Gestion des catégories et produits
- Photos produit téléversées depuis l'ordinateur (JPEG, PNG ou WebP, 5 Mo maximum)
- Mouvements d'entrée/sortie avec mise à jour du stock
- Tableau de bord et alertes de seuil
- Historique et export CSV
- Bascule entre thème clair et sombre, avec préférence mémorisée sur l'appareil

## Charte visuelle

L'interface utilise une direction « ERP moderne » inspirée d'un tableau de bord vert d'eau et vert foncé. Un bouton dans la navigation permet de basculer en mode sombre; le choix est mémorisé dans le navigateur.

- **Mode clair** : fond vert d'eau `#e8f2ef`, panneaux clairs, navigation vert foncé et actions dorées
- **Mode sombre** : surfaces vert profond, texte clair et accents dorés
- **États** : vert (succès), ambre (alerte), rouge (erreur), adaptés aux deux thèmes
- **Typographie** : Segoe UI, Inter ou Roboto, avec chiffres tabulaires pour les données de stock
- **Composants** : contrôles arrondis à 10 px, cartes à 16 px, panneaux à 18 px; bordures discrètes et ombres peu contrastées
- **Tableaux et filtres** : filtres regroupés dans un panneau, en-têtes contrastés, lignes alternées et survolées, défilement horizontal contenu sur petits écrans

Les couleurs, rayons, espacements et typographies réutilisables sont centralisés en variables CSS dans `public/style.css`.

## Données

La base SQLite est stockée dans `stock.db` (ignorée par git). Les photos produit sont conservées dans `public/uploads/`, associées aux produits et supprimées lorsqu'un produit est supprimé ou que sa photo est remplacée. Le champ image est ajouté automatiquement aux bases existantes.

Avec Docker Compose, la base et les photos sont conservées dans des volumes dédiés.