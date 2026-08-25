import { firebaseConfig } from "./firebase-config.js";

const FIREBASE_VERSION = "10.12.2";
const isConfigured = firebaseConfig.apiKey && firebaseConfig.apiKey !== "TU_API_KEY";

const els = {
  loginWrap: document.getElementById("login-wrap"),
  loginForm: document.getElementById("login-form"),
  loginError: document.getElementById("login-error"),
  setupWarning: document.getElementById("setup-warning"),
  appShell: document.getElementById("app-shell"),
  userEmail: document.getElementById("user-email"),
  logoutBtn: document.getElementById("logout-btn"),
  statTotal: document.getElementById("stat-total"),
  statVencidos: document.getElementById("stat-vencidos"),
  statBloqueados: document.getElementById("stat-bloqueados"),
  statIngresos: document.getElementById("stat-ingresos"),
  search: document.getElementById("search"),
  filterEstado: document.getElementById("filter-estado"),
  newClientBtn: document.getElementById("new-client-btn"),
  clientList: document.getElementById("client-list"),
  emptyState: document.getElementById("empty-state"),
  modalBackdrop: document.getElementById("modal-backdrop"),
  clientForm: document.getElementById("client-form"),
  modalTitle: document.getElementById("modal-title"),
  cancelModalBtn: document.getElementById("cancel-modal-btn"),
};

let auth, db;
let fb = {}; // holds the dynamically-loaded Firestore functions we call by name
let clients = [];
let currentUser = null;
let editingId = null;

async function init() {
  if (!isConfigured) {
    els.setupWarning.classList.remove("hidden");
    els.setupWarning.textContent =
      "Falta configurar Firebase: edita firebase-config.js con las credenciales de tu proyecto (ver README.md).";
    return;
  }

  let appModule, authModule, firestoreModule;
  try {
    [appModule, authModule, firestoreModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
    ]);
  } catch (err) {
    els.setupWarning.classList.remove("hidden");
    els.setupWarning.textContent =
      "No se pudo cargar Firebase (revisa tu conexión a internet o si algo está bloqueando gstatic.com).";
    return;
  }

  const app = appModule.initializeApp(firebaseConfig);
  auth = authModule.getAuth(app);
  db = firestoreModule.getFirestore(app);
  fb = {
    onAuthStateChanged: authModule.onAuthStateChanged,
    signInWithEmailAndPassword: authModule.signInWithEmailAndPassword,
    signOut: authModule.signOut,
    collection: firestoreModule.collection,
    query: firestoreModule.query,
    where: firestoreModule.where,
    onSnapshot: firestoreModule.onSnapshot,
    addDoc: firestoreModule.addDoc,
    updateDoc: firestoreModule.updateDoc,
    deleteDoc: firestoreModule.deleteDoc,
    doc: firestoreModule.doc,
  };

  fb.onAuthStateChanged(auth, handleAuthChange);

  els.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.loginError.textContent = "";
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    try {
      await fb.signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      els.loginError.textContent = traducirErrorAuth(err.code);
    }
  });

  els.logoutBtn.addEventListener("click", () => fb.signOut(auth));
}

function traducirErrorAuth(code) {
  const map = {
    "auth/invalid-email": "Correo inválido.",
    "auth/user-not-found": "No existe una cuenta con ese correo.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento.",
  };
  return map[code] || "No se pudo iniciar sesión.";
}

function handleAuthChange(user) {
  currentUser = user;
  if (user) {
    els.loginWrap.classList.add("hidden");
    els.appShell.classList.remove("hidden");
    els.userEmail.textContent = user.email;
    subscribeClients(user.uid);
  } else {
    els.loginWrap.classList.remove("hidden");
    els.appShell.classList.add("hidden");
    clients = [];
  }
}

let unsubscribeClients = null;

function subscribeClients(uid) {
  if (unsubscribeClients) unsubscribeClients();
  const q = fb.query(fb.collection(db, "clients"), fb.where("ownerId", "==", uid));
  unsubscribeClients = fb.onSnapshot(q, (snap) => {
    clients = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function addDaysISO(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

function computeStatus(client) {
  if (client.bloqueadoManual) return "bloqueado";
  const today = todayISO();
  if (client.fechaVencimiento < today) return "vencido";
  const diffDays = Math.round(
    (new Date(client.fechaVencimiento) - new Date(today)) / 86400000
  );
  if (diffDays <= 3) return "por_vencer";
  return "al_dia";
}

const STATUS_LABEL = {
  al_dia: "Al día",
  por_vencer: "Por vencer",
  vencido: "Vencido",
  bloqueado: "Bloqueado",
};

function render() {
  const search = els.search.value.trim().toLowerCase();
  const filter = els.filterEstado.value;

  const withStatus = clients.map((c) => ({ ...c, estado: computeStatus(c) }));

  let visible = withStatus.filter((c) => {
    const matchesSearch =
      !search || c.nombre.toLowerCase().includes(search);
    const matchesFilter = filter === "todos" || c.estado === filter;
    return matchesSearch && matchesFilter;
  });

  visible.sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));

  els.statTotal.textContent = clients.length;
  els.statVencidos.textContent = withStatus.filter(
    (c) => c.estado === "vencido"
  ).length;
  els.statBloqueados.textContent = withStatus.filter(
    (c) => c.estado === "bloqueado"
  ).length;
  const ingresos = withStatus
    .filter((c) => c.estado !== "bloqueado")
    .reduce((sum, c) => sum + (Number(c.monto) || 0), 0);
  els.statIngresos.textContent = formatMoney(ingresos);

  els.clientList.innerHTML = "";
  els.emptyState.classList.toggle("hidden", visible.length > 0);

  for (const client of visible) {
    els.clientList.appendChild(renderClientCard(client));
  }
}

function formatMoney(n) {
  return "$" + n.toLocaleString("es", { maximumFractionDigits: 2 });
}

function renderClientCard(client) {
  const card = document.createElement("div");
  card.className = "client-card";

  const top = document.createElement("div");
  top.className = "client-top";

  const left = document.createElement("div");
  left.innerHTML = `
    <div class="client-name">${escapeHtml(client.nombre)}</div>
    <div class="client-meta">${escapeHtml(client.contacto || "Sin contacto")}</div>
    <div class="client-meta">Vence: ${client.fechaVencimiento} · ${formatMoney(Number(client.monto) || 0)}</div>
    ${client.perfilPin ? `<div class="client-meta">Perfil/PIN: ${escapeHtml(client.perfilPin)}</div>` : ""}
  `;

  const badge = document.createElement("span");
  badge.className = `badge ${client.estado}`;
  badge.textContent = STATUS_LABEL[client.estado];

  top.appendChild(left);
  top.appendChild(badge);
  card.appendChild(top);

  const actions = document.createElement("div");
  actions.className = "client-actions";

  const editBtn = actionButton("Editar", "secondary", () => openModal(client));
  actions.appendChild(editBtn);

  if (client.estado !== "bloqueado") {
    actions.appendChild(
      actionButton("Marcar pagado", "secondary", () => markPaid(client))
    );
    actions.appendChild(
      actionButton("Bloquear", "block-btn", () => toggleBlock(client, true))
    );
  } else {
    actions.appendChild(
      actionButton("Desbloquear", "unblock-btn", () => toggleBlock(client, false))
    );
  }

  actions.appendChild(
    actionButton("Eliminar", "danger", () => removeClient(client))
  );

  card.appendChild(actions);

  if (client.estado === "bloqueado") {
    card.appendChild(renderBlockPanel(client));
  }

  return card;
}

function renderBlockPanel(client) {
  const panel = document.createElement("div");
  panel.className = "block-checklist";

  const manualChecklist = `
    <ol>
      <li>Entra a netflix.com/account con tu cuenta principal.</li>
      <li>Ve a "Miembro extra" / "Gestionar acceso".</li>
      <li>Selecciona a ${escapeHtml(client.nombre)} y elige "Eliminar" o "Pausar acceso".</li>
    </ol>
  `;

  if (client.netflixRemovalStatus === "in_progress") {
    panel.innerHTML = `<strong>🤖 El bot está intentando retirarlo de Netflix ahora mismo…</strong>`;
  } else if (client.netflixRemovalStatus === "done") {
    panel.innerHTML = `<strong>✅ El bot ya lo retiró automáticamente de Netflix.</strong>`;
  } else if (client.netflixRemovalStatus === "failed") {
    panel.innerHTML = `
      <strong>⚠️ El bot no pudo retirarlo automáticamente</strong>
      <div>${escapeHtml(client.netflixRemovalMessage || "Error sin detalle.")}</div>
      <strong>Hazlo manualmente mientras tanto:</strong>
      ${manualChecklist}
    `;
    panel.appendChild(
      actionButton("Reintentar automatización", "secondary", () => retryNetflixRemoval(client))
    );
  } else {
    panel.innerHTML = `
      <strong>Pendiente por hacer en Netflix</strong>
      ${manualChecklist}
      Este sistema no puede hacerlo por ti a menos que hayas configurado el bot automático (ver README).
    `;
  }

  return panel;
}

async function retryNetflixRemoval(client) {
  await fb.updateDoc(fb.doc(db, "clients", client.id), { netflixRemovalStatus: "pending" });
}

function actionButton(label, cls, onClick) {
  const btn = document.createElement("button");
  btn.className = `btn ${cls}`;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

async function markPaid(client) {
  const ciclo = Number(client.cicloDias) || 30;
  const nuevaFecha = addDaysISO(todayISO(), ciclo);
  const historial = Array.isArray(client.historialPagos)
    ? client.historialPagos.slice(-11)
    : [];
  historial.push({ fecha: todayISO(), monto: Number(client.monto) || 0 });
  await fb.updateDoc(fb.doc(db, "clients", client.id), {
    fechaVencimiento: nuevaFecha,
    bloqueadoManual: false,
    historialPagos: historial,
  });
}

async function toggleBlock(client, blocked) {
  await fb.updateDoc(fb.doc(db, "clients", client.id), { bloqueadoManual: blocked });
}

async function removeClient(client) {
  if (!confirm(`¿Eliminar a ${client.nombre}? Esta acción no se puede deshacer.`)) {
    return;
  }
  await fb.deleteDoc(fb.doc(db, "clients", client.id));
}

els.search.addEventListener("input", render);
els.filterEstado.addEventListener("change", render);

els.newClientBtn.addEventListener("click", () => openModal(null));
els.cancelModalBtn.addEventListener("click", closeModal);
els.modalBackdrop.addEventListener("click", (e) => {
  if (e.target === els.modalBackdrop) closeModal();
});

function openModal(client) {
  editingId = client ? client.id : null;
  els.modalTitle.textContent = client ? "Editar cliente" : "Nuevo cliente";
  els.clientForm.reset();
  if (client) {
    document.getElementById("field-nombre").value = client.nombre || "";
    document.getElementById("field-contacto").value = client.contacto || "";
    document.getElementById("field-monto").value = client.monto ?? "";
    document.getElementById("field-vencimiento").value = client.fechaVencimiento || todayISO();
    document.getElementById("field-ciclo").value = client.cicloDias ?? 30;
    document.getElementById("field-perfil").value = client.perfilPin || "";
    document.getElementById("field-email-netflix").value = client.emailNetflix || "";
  } else {
    document.getElementById("field-vencimiento").value = todayISO();
    document.getElementById("field-ciclo").value = 30;
  }
  els.modalBackdrop.classList.remove("hidden");
}

function closeModal() {
  els.modalBackdrop.classList.add("hidden");
  editingId = null;
}

els.clientForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {
    nombre: document.getElementById("field-nombre").value.trim(),
    contacto: document.getElementById("field-contacto").value.trim(),
    monto: Number(document.getElementById("field-monto").value) || 0,
    fechaVencimiento: document.getElementById("field-vencimiento").value,
    cicloDias: Number(document.getElementById("field-ciclo").value) || 30,
    perfilPin: document.getElementById("field-perfil").value.trim(),
    emailNetflix: document.getElementById("field-email-netflix").value.trim(),
  };
  if (!data.nombre || !data.fechaVencimiento) return;

  if (editingId) {
    await fb.updateDoc(fb.doc(db, "clients", editingId), data);
  } else {
    await fb.addDoc(fb.collection(db, "clients"), {
      ...data,
      ownerId: currentUser.uid,
      bloqueadoManual: false,
      historialPagos: [],
    });
  }
  closeModal();
});

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js");
  });
}
