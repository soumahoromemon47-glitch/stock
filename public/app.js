const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
function escapeHtml(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
let categories = [],
  produits = [];
let produitsTotal = 0;
let produitsPage = 1;
const PAGE_SIZE = 12;
let produitFiltres = { recherche: "", categorie: "", alertesOnly: false };

let historique = [];
let historiqueTotal = 0;
let historiquePage = 1;
let historiqueFiltres = { search: "", type: "", from: "", to: "" };

function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

function updateTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = isDark
    ? "#132321"
    : "#e8f2ef";
  $("#theme-toggle").setAttribute("aria-pressed", String(isDark));
  $("#theme-toggle").setAttribute(
    "aria-label",
    isDark ? "Activer le mode clair" : "Activer le mode sombre",
  );
  $("#theme-toggle-label").textContent = isDark ? "Mode clair" : "Mode sombre";
}

const themeToggle = $("#theme-toggle");
let currentTheme = "light";
try {
  currentTheme = localStorage.getItem("stock-theme") === "dark" ? "dark" : "light";
} catch (error) {
  console.error("Impossible de lire la préférence de thème", error);
}
updateTheme(currentTheme);
themeToggle.addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  updateTheme(currentTheme);
  try {
    localStorage.setItem("stock-theme", currentTheme);
  } catch (error) {
    console.error("Impossible d'enregistrer la préférence de thème", error);
    toast("Le thème est modifié, mais la préférence n'a pas pu être enregistrée.", true);
  }
});

function exportCSV(nomFichier, colonnes, lignes) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = colonnes.map((c) => esc(c.label)).join(";");
  const body = lignes
    .map((l) =>
      colonnes
        .map((c) =>
          esc(typeof c.value === "function" ? c.value(l) : l[c.value]),
        )
        .join(";"),
    )
    .join("\r\n");

  // BOM UTF-8 + contenu ; séparateur ';' pour Excel FR
  const blob = new Blob(["\uFEFF" + header + "\r\n" + body], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomFichier;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`Export : ${nomFichier}`);
}

function dateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function setImagePreview(preview, source) {
  if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
  preview.src = source || "";
  preview.classList.toggle("hidden", !source);
  preview.dataset.objectUrl = source && source.startsWith("blob:") ? source : "";
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (typeof options.body === "string") {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  } else if (
    options.body &&
    Object.prototype.toString.call(options.body) === "[object FormData]"
  ) {
    headers.delete("Content-Type");
  }
  const res = await fetch(url, { ...options, headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

// Navigation
$$(".nav-btn[data-tab]").forEach((btn) =>
  btn.addEventListener("click", () => {
    $$(".nav-btn").forEach((b) => b.classList.remove("active"));
    $$(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    $("#tab-" + btn.dataset.tab).classList.add("active");
  }),
);

// Chargements
async function loadCategories() {
  categories = await api("/api/categories");
  $("#sel-categorie-produit").innerHTML =
    '<option value="">— Aucune —</option>' +
    categories.map((c) => `<option value="${c.id}">${escapeHtml(c.nom)}</option>`).join("");
  const selFiltre = document.getElementById("filter-categorie");
  if (selFiltre) {
    const current = selFiltre.value;
    selFiltre.innerHTML =
      '<option value="">Toutes les catégories</option>' +
      categories
        .map((c) => `<option value="${c.id}">${escapeHtml(c.nom)}</option>`)
        .join("");
    selFiltre.value = current;
  }
  renderCategories();
}

async function loadProduits() {
  const params = new URLSearchParams();
  params.set("page", produitsPage);
  params.set("pageSize", PAGE_SIZE);
  if (produitFiltres.recherche)
    params.set("search", produitFiltres.recherche);
  if (produitFiltres.categorie)
    params.set("categorie", produitFiltres.categorie);
  if (produitFiltres.alertesOnly) params.set("alertes", "true");

  const data = await api("/api/produits?" + params.toString());
  produits = data.items || [];
  produitsTotal = data.total || 0;

  renderProduits();
  renderPagination("produits", produitsTotal, produitsPage, (p) => {
    produitsPage = p;
    loadProduits();
  });

  // dropdown mouvements : liste complète
  const all = await api("/api/produits?pageSize=1000");
  const allItems = all.items || [];
  $("#sel-produit-mvt").innerHTML = allItems
    .map(
      (p) =>
        `<option value="${p.id}">${escapeHtml(p.nom)} (stock : ${p.stock_actuel})</option>`,
    )
    .join("");
}

async function loadDashboard() {
  const d = await api("/api/dashboard");
  $("#m-total").textContent = d.total;
  $("#m-stock").textContent = d.totalStock;
  $("#m-valeur").textContent = d.valeur.toLocaleString("fr-FR") + " FCFA";
  $("#m-alertes").textContent = d.alertes.length;
  const section = $("#alertes-section");
  if (d.alertes.length === 0) {
    section.classList.add("hidden");
    $("#alertes-list").innerHTML = "";
  } else {
    section.classList.remove("hidden");
    $("#alertes-list").innerHTML =
      `<table><thead><tr><th>Réf</th><th>Nom</th><th>Stock</th><th>Seuil</th></tr></thead><tbody>` +
      d.alertes
        .map(
          (a) => `<tr><td>${escapeHtml(a.reference)}</td><td>${escapeHtml(a.nom)}</td>
      <td><span class="badge warn">${a.stock_actuel}</span></td><td>${a.seuil_alerte}</td></tr>`,
        )
        .join("") +
      `</tbody></table>`;
  }
}

async function loadHistorique() {
  const params = new URLSearchParams();
  params.set("page", historiquePage);
  params.set("pageSize", PAGE_SIZE);
  if (historiqueFiltres.search)
    params.set("search", historiqueFiltres.search);
  if (historiqueFiltres.type) params.set("type", historiqueFiltres.type);
  if (historiqueFiltres.from) params.set("from", historiqueFiltres.from);
  if (historiqueFiltres.to) params.set("to", historiqueFiltres.to);

  const data = await api("/api/mouvements?" + params.toString());
  historique = data.items || [];
  historiqueTotal = data.total || 0;

  $("#historique-list").innerHTML = historique.length
    ? `<table><thead><tr><th>Date</th><th>Type</th><th>Produit</th><th>Qté</th><th>Motif</th></tr></thead><tbody>` +
      historique
        .map(
          (r) => `<tr><td>${r.date}</td>
        <td><span class="badge ${r.type.toLowerCase()}">${r.type}</span></td>
        <td>${escapeHtml(r.produit)} <small style="color:#6b7280">(${escapeHtml(r.reference)})</small></td>
        <td>${r.quantite}</td><td>${escapeHtml(r.motif || "")}</td></tr>`,
        )
        .join("") +
      `</tbody></table>`
    : '<p style="color:#6b7280">Aucun mouvement.</p>';

  renderPagination("historique", historiqueTotal, historiquePage, (p) => {
    historiquePage = p;
    loadHistorique();
  });
}

// Rendus
function renderCategories() {
  $("#categories-list").innerHTML = categories.length
    ? `<table><thead><tr><th>ID</th><th>Nom</th><th></th></tr></thead><tbody>` +
      categories
        .map(
          (c) => `<tr><td>${c.id}</td><td>${escapeHtml(c.nom)}</td>
        <td><button class="btn-danger" onclick="supprimerCategorie(${c.id})">Supprimer</button></td></tr>`,
        )
        .join("") +
      `</tbody></table>`
    : '<p style="color:#6b7280">Aucune catégorie.</p>';
}

function renderProduits() {
  const liste = produits;

  const compteur = document.getElementById("produits-count");
  if (compteur) {
    compteur.textContent =
      produitsTotal === produits.length && produitsPage === 1
        ? `${produitsTotal} produit(s)`
        : `${produits.length} sur ${produitsTotal} produit(s)`;
  }

  $("#produits-list").innerHTML = liste.length
    ? `<table><thead><tr><th>Photo</th><th>Réf</th><th>Nom</th><th>Marque</th><th>Catégorie</th>
        <th>Stock</th><th>Seuil</th><th>Prix achat</th><th>Prix vente</th><th></th></tr></thead><tbody>` +
      liste
        .map(
          (p) => `<tr><td><div class="product-thumb">${p.image_url
            ? `<img src="${escapeHtml(p.image_url)}" alt="Photo de ${escapeHtml(p.nom)}" loading="lazy" />`
            : '<span aria-label="Pas de photo">—</span>'}</div></td><td>${escapeHtml(p.reference)}</td><td>${escapeHtml(p.nom)}</td><td>${escapeHtml(p.marque || "")}</td>
        <td>${escapeHtml(p.categorie || "")}</td>
        <td>${p.stock_actuel <= p.seuil_alerte ? `<span class="badge warn">${p.stock_actuel}</span>` : p.stock_actuel}</td>
        <td>${p.seuil_alerte}</td><td>${p.prix_achat}</td><td>${p.prix_vente}</td>
        <td class="product-actions-cell">
          <div class="product-actions">
          <button class="btn-edit" onclick="ouvrirModif(${p.id})">Modifier</button>
          <button class="btn-danger" onclick="supprimerProduit(${p.id})">Supprimer</button>
          </div>
        </td></tr>`,
        )
        .join("") +
      `</tbody></table>`
    : `<p style="color:#6b7280; padding:15px; text-align:center;">
         ${produitsTotal === 0 ? "Aucun produit pour le moment." : "Aucun produit ne correspond aux filtres."}
       </p>`;
}

function renderPagination(container, total, page, onPage) {
  const el = document.getElementById(container + "-pagination");
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) {
    el.innerHTML = total
      ? `<span class="info">${total} résultat(s)</span>`
      : "";
    return;
  }
  let html = "";
  html += `<button ${page <= 1 ? "disabled" : ""} data-p="${page - 1}">◀</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) {
      html += `<button class="${i === page ? "active" : ""}" data-p="${i}">${i}</button>`;
    } else if (i === page - 2 || i === page + 2) {
      html += `<span class="info">…</span>`;
    }
  }
  html += `<button ${page >= totalPages ? "disabled" : ""} data-p="${page + 1}">▶</button>`;
  html += `<span class="info">${total} résultat(s)</span>`;
  el.innerHTML = html;
  el.querySelectorAll("button[data-p]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = Number(btn.dataset.p);
      if (p >= 1 && p <= totalPages && p !== page) onPage(p);
    });
  });
}

// Actions
window.supprimerCategorie = async (id) => {
  if (!confirm("Supprimer cette catégorie ?")) return;
  await api(`/api/categories/${id}`, { method: "DELETE" });
  toast("Catégorie supprimée");
  await refreshAll();
};
window.supprimerProduit = async (id) => {
  if (!confirm("Supprimer ce produit ?")) return;
  await api(`/api/produits/${id}`, { method: "DELETE" });
  toast("Produit supprimé");
  await refreshAll();
};

window.ouvrirModif = function (id) {
  const p = produits.find((x) => x.id === id);
  if (!p) return;
  const form = $("#form-edit");
  form.elements["id"].value = p.id;
  form.elements["reference"].value = p.reference || "";
  form.elements["nom"].value = p.nom || "";
  form.elements["marque"].value = p.marque || "";
  form.elements["prix_achat"].value = p.prix_achat ?? 0;
  form.elements["prix_vente"].value = p.prix_vente ?? 0;
  form.elements["seuil_alerte"].value = p.seuil_alerte ?? 1;
  form.elements["image"].value = "";
  const imagePreview = $("#edit-image-preview");
  setImagePreview(imagePreview, p.image_url || "");

  const sel = form.elements["categorie_id"];
  sel.innerHTML =
    '<option value="">— Aucune —</option>' +
    categories.map((c) => `<option value="${c.id}">${escapeHtml(c.nom)}</option>`).join("");
  sel.value = p.categorie_id || "";

  $("#modal-edit").classList.add("show");
};

window.closeEdit = function () {
  $("#modal-edit").classList.remove("show");
  setImagePreview($("#edit-image-preview"), "");
};

function validateProduitForm(form) {
  const formData = new FormData(form);
  const reference = String(formData.get("reference") ?? "").trim();
  const nom = String(formData.get("nom") ?? "").trim();

  if (!reference || !nom) {
    const field = !reference ? form.elements["reference"] : form.elements["nom"];
    if (field) field.focus();
    throw new Error(
      !reference && !nom
        ? "La référence et le nom du produit sont requis avant d'ajouter une photo."
        : !reference
          ? "La référence du produit est requise."
          : "Le nom du produit est requis.",
    );
  }

  return formData;
}

// Formulaires
$("#form-categorie").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nom = new FormData(e.target).get("nom");
  try {
    await api("/api/categories", {
      method: "POST",
      body: JSON.stringify({ nom }),
    });
    e.target.reset();
    $("#form-categorie").classList.add("hidden");
    $("#btn-add-categorie").textContent = "➕ Ajouter une catégorie";
    toast("Catégorie ajoutée");
    await refreshAll();
  } catch (err) {
    toast(err.message, true);
  }
});

$("#form-produit").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!e.target.reportValidity()) return;
  try {
    const formData = validateProduitForm(e.target);
    await api("/api/produits", {
      method: "POST",
      body: formData,
    });
    e.target.reset();
    setImagePreview($("#new-image-preview"), "");
    $("#form-produit").classList.add("hidden");
    $("#btn-add-produit").textContent = "➕ Ajouter un produit";
    produitsPage = 1;
    toast("Produit ajouté");
    await refreshAll();
  } catch (err) {
    toast(err.message, true);
  }
});

$("#form-mouvement").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api("/api/mouvements", {
      method: "POST",
      body: JSON.stringify({
        produit_id: Number(f.get("produit_id")),
        type: f.get("type"),
        quantite: Number(f.get("quantite")),
        motif: f.get("motif"),
      }),
    });
    e.target.reset();
    toast("Mouvement enregistré");
    await refreshAll();
    historiquePage = 1;
    await loadHistorique();
  } catch (err) {
    toast(err.message, true);
  }
});

// Init
async function refreshAll() {
  await loadCategories();
  await loadProduits();
  await loadDashboard();
}

$("#form-edit").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!e.target.reportValidity()) return;
  const f = new FormData(e.target);
  const reference = String(f.get("reference") ?? "").trim();
  const nom = String(f.get("nom") ?? "").trim();
  if (!reference || !nom) {
    const field = !reference ? e.target.elements["reference"] : e.target.elements["nom"];
    if (field) field.focus();
    toast(
      !reference && !nom
        ? "La référence et le nom du produit sont requis."
        : !reference
          ? "La référence du produit est requise."
          : "Le nom du produit est requis.",
      true,
    );
    return;
  }
  const id = Number(f.get("id"));
  const imageSelected = e.target.elements["image"].files.length > 0;
  const body = imageSelected
    ? f
    : JSON.stringify(
        Object.fromEntries(
          [...f].filter(([name]) => name !== "id" && name !== "image"),
        ),
      );
  try {
    await api(`/api/produits/${id}`, {
      method: "PUT",
      body,
    });
    closeEdit();
    toast("Produit modifié");
    await refreshAll();
  } catch (err) {
    toast(err.message, true);
  }
});

document.querySelectorAll('input[type="file"][name="image"]').forEach((input) => {
  input.addEventListener("change", () => {
    const preview = input.form.id === "form-edit"
      ? $("#edit-image-preview")
      : $("#new-image-preview");
    const file = input.files[0];
    if (!file || !preview) return;
    setImagePreview(preview, URL.createObjectURL(file));
  });
});

// Fermer la modale en cliquant à l'extérieur ou avec Échap
$("#modal-edit").addEventListener("click", (e) => {
  if (e.target.id === "modal-edit") closeEdit();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeEdit();
});

$("#btn-add-produit").addEventListener("click", () => {
  const f = $("#form-produit");
  const btn = $("#btn-add-produit");
  f.classList.toggle("hidden");
  if (f.classList.contains("hidden")) {
    btn.textContent = "➕ Ajouter un produit";
  } else {
    btn.textContent = "✖ Fermer le formulaire";
    f.elements["reference"].focus();
  }
});

$("#btn-add-categorie").addEventListener("click", () => {
  const f = $("#form-categorie");
  const btn = $("#btn-add-categorie");
  f.classList.toggle("hidden");
  if (f.classList.contains("hidden")) {
    btn.textContent = "➕ Ajouter une catégorie";
  } else {
    btn.textContent = "✖ Fermer le formulaire";
    f.elements["nom"].focus();
  }
});

$("#search-produit").addEventListener("input", (e) => {
  produitFiltres.recherche = e.target.value;
  produitsPage = 1;
  loadProduits();
});

$("#filter-categorie").addEventListener("change", (e) => {
  produitFiltres.categorie = e.target.value;
  produitsPage = 1;
  loadProduits();
});

$("#filter-alertes").addEventListener("change", (e) => {
  produitFiltres.alertesOnly = e.target.checked;
  produitsPage = 1;
  loadProduits();
});

$("#btn-export-produits").addEventListener("click", async () => {
  const params = new URLSearchParams();
  params.set("pageSize", 100000);
  if (produitFiltres.recherche)
    params.set("search", produitFiltres.recherche);
  if (produitFiltres.categorie)
    params.set("categorie", produitFiltres.categorie);
  if (produitFiltres.alertesOnly) params.set("alertes", "true");

  const data = await api("/api/produits?" + params.toString());
  const liste = data.items || [];
  if (liste.length === 0) {
    toast("Aucun produit à exporter", true);
    return;
  }

  exportCSV(
    `produits_${dateStamp()}.csv`,
    [
      { label: "ID", value: "id" },
      { label: "Référence", value: "reference" },
      { label: "Nom", value: "nom" },
      { label: "Marque", value: "marque" },
      { label: "Catégorie", value: "categorie" },
      { label: "Stock actuel", value: "stock_actuel" },
      { label: "Seuil alerte", value: "seuil_alerte" },
      { label: "Prix achat", value: "prix_achat" },
      { label: "Prix vente", value: "prix_vente" },
      {
        label: "Valeur stock (achat)",
        value: (p) => (p.stock_actuel * p.prix_achat).toFixed(2),
      },
    ],
    liste,
  );
});

$("#btn-export-historique").addEventListener("click", async () => {
  const params = new URLSearchParams();
  params.set("pageSize", 100000);
  if (historiqueFiltres.search) params.set("search", historiqueFiltres.search);
  if (historiqueFiltres.type) params.set("type", historiqueFiltres.type);
  if (historiqueFiltres.from) params.set("from", historiqueFiltres.from);
  if (historiqueFiltres.to) params.set("to", historiqueFiltres.to);

  const data = await api("/api/mouvements?" + params.toString());
  const rows = data.items || [];
  if (rows.length === 0) {
    toast("Aucun mouvement à exporter", true);
    return;
  }
  exportCSV(
    `historique_${dateStamp()}.csv`,
    [
      { label: "ID", value: "id" },
      { label: "Date", value: "date" },
      { label: "Type", value: "type" },
      { label: "Référence", value: "reference" },
      { label: "Produit", value: "produit" },
      { label: "Quantité", value: "quantite" },
      { label: "Motif", value: "motif" },
    ],
    rows,
  );
});

function bindHistoriqueFilters() {
  const reload = () => {
    historiquePage = 1;
    loadHistorique();
  };
  $("#search-historique").addEventListener("input", (e) => {
    historiqueFiltres.search = e.target.value;
    reload();
  });
  $("#filter-type-mvt").addEventListener("change", (e) => {
    historiqueFiltres.type = e.target.value;
    reload();
  });
  $("#filter-from").addEventListener("change", (e) => {
    historiqueFiltres.from = e.target.value;
    reload();
  });
  $("#filter-to").addEventListener("change", (e) => {
    historiqueFiltres.to = e.target.value;
    reload();
  });
}

refreshAll();
bindHistoriqueFilters();
loadHistorique();
