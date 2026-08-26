import { firebaseConfig } from "../firebase-config.js";

const FIREBASE_VERSION = "10.12.2";
const isConfigured = firebaseConfig.apiKey && firebaseConfig.apiKey !== "TU_API_KEY";

const els = {
  loginCard: document.getElementById("login-card"),
  googleBtn: document.getElementById("google-btn"),
  loginError: document.getElementById("login-error"),
  setupWarning: document.getElementById("setup-warning"),
  accountCard: document.getElementById("account-card"),
  userName: document.getElementById("user-name"),
  logoutBtn: document.getElementById("logout-btn"),
  statusBlock: document.getElementById("status-block"),
  statusPlan: document.getElementById("status-plan"),
  statusBadge: document.getElementById("status-badge"),
  statusVenc: document.getElementById("status-venc"),
  accessGrid: document.getElementById("access-grid"),
  paywall: document.getElementById("paywall"),
  renewBtn: document.getElementById("renew-btn"),
  signupForm: document.getElementById("signup-form"),
  fieldNombre: document.getElementById("field-nombre"),
  fieldContacto: document.getElementById("field-contacto"),
  fieldPlan: document.getElementById("field-plan"),
  planPreview: document.getElementById("plan-preview"),
  payBtn: document.getElementById("pay-btn"),
  signupError: document.getElementById("signup-error"),
  returnBanner: document.getElementById("return-banner"),
};

let auth, db, functions;
let fb = {};
let currentUser = null;
let myClient = null;
let plans = [];

const STATUS_LABEL = { al_dia: "Al día", por_vencer: "Por vencer", vencido: "Vencido", bloqueado: "Bloqueado" };

// A dónde manda cada tarjeta de plataforma. Enlaza a la página/app oficial
// de cada servicio (ahí el cliente inicia sesión con las credenciales que
// le diste) — esta app nunca aloja ni retransmite contenido de video.
const PLATFORM_LINKS = {
  "Netflix": { url: "https://www.netflix.com", color: "#e50914" },
  "Disney+": { url: "https://www.disneyplus.com", color: "#113ccf" },
  "HBO Max": { url: "https://www.max.com", color: "#6c2fbf" },
  "Prime Video": { url: "https://www.primevideo.com", color: "#00a8e1" },
  "Star+": { url: "https://www.starplus.com", color: "#0a0e17" },
  "Otro": { url: "#", color: "#6b7280" },
};

async function init() {
  showReturnBanner();

  if (!isConfigured) {
    showSetupWarning("Falta configurar Firebase: edita firebase-config.js en la raíz del repositorio.");
    return;
  }

  let appModule, authModule, firestoreModule, functionsModule;
  try {
    [appModule, authModule, firestoreModule, functionsModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-functions.js`),
    ]);
  } catch (err) {
    showSetupWarning("No se pudo cargar Firebase (revisa tu conexión a internet).");
    return;
  }

  const app = appModule.initializeApp(firebaseConfig);
  auth = authModule.getAuth(app);
  db = firestoreModule.getFirestore(app);
  functions = functionsModule.getFunctions(app);

  fb = {
    onAuthStateChanged: authModule.onAuthStateChanged,
    signInWithPopup: authModule.signInWithPopup,
    GoogleAuthProvider: authModule.GoogleAuthProvider,
    signOut: authModule.signOut,
    collection: firestoreModule.collection,
    query: firestoreModule.query,
    where: firestoreModule.where,
    limit: firestoreModule.limit,
    onSnapshot: firestoreModule.onSnapshot,
    getDocs: firestoreModule.getDocs,
    httpsCallable: functionsModule.httpsCallable,
  };

  fb.onAuthStateChanged(auth, handleAuthChange);

  els.googleBtn.addEventListener("click", async () => {
    els.loginError.textContent = "";
    try {
      await fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
    } catch (err) {
      els.loginError.textContent = "No se pudo iniciar sesión con Google. Intenta de nuevo.";
    }
  });

  els.logoutBtn.addEventListener("click", () => fb.signOut(auth));
}

function showSetupWarning(msg) {
  els.setupWarning.classList.remove("hidden");
  els.setupWarning.textContent = msg;
}

function showReturnBanner() {
  const params = new URLSearchParams(window.location.search);
  const pago = params.get("pago");
  if (!pago) return;
  const msgs = {
    exito: "¡Pago aprobado! Puede tardar unos segundos en reflejarse aquí.",
    fallo: "El pago no se completó. Puedes intentarlo de nuevo.",
    pendiente: "Tu pago está pendiente de confirmación.",
  };
  if (!msgs[pago]) return;
  els.returnBanner.textContent = msgs[pago];
  els.returnBanner.className = `banner ${pago}`;
  els.returnBanner.classList.remove("hidden");
}

async function handleAuthChange(user) {
  currentUser = user;
  if (!user) {
    els.loginCard.classList.remove("hidden");
    els.accountCard.classList.add("hidden");
    return;
  }
  els.loginCard.classList.add("hidden");
  els.accountCard.classList.remove("hidden");
  els.userName.textContent = user.displayName || user.email;
  els.fieldNombre.value = user.displayName || "";

  await loadPlans();
  subscribeMyClient(user.uid);
}

function subscribeMyClient(uid) {
  const q = fb.query(fb.collection(db, "clients"), fb.where("customerUid", "==", uid), fb.limit(1));
  fb.onSnapshot(q, (snap) => {
    myClient = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    render();
  });
}

async function loadPlans() {
  const snap = await fb.getDocs(fb.collection(db, "plans"));
  plans = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  els.fieldPlan.innerHTML = "";
  for (const plan of plans) {
    const opt = document.createElement("option");
    opt.value = plan.id;
    opt.textContent = `${plan.nombre} — ${formatMoney(plan.precio)} (${(plan.servicios || []).join(", ")})`;
    els.fieldPlan.appendChild(opt);
  }
  updatePlanPreview();
}

function formatMoney(n) {
  return "S/ " + (Number(n) || 0).toLocaleString("es-PE", { maximumFractionDigits: 2 });
}

function updatePlanPreview() {
  const plan = plans.find((p) => p.id === els.fieldPlan.value);
  els.planPreview.textContent = plan
    ? `Incluye: ${(plan.servicios || []).join(", ")} · ${formatMoney(plan.precio)} cada ciclo`
    : "";
}

els.fieldPlan.addEventListener("change", updatePlanPreview);

function computeStatus(client) {
  if (client.bloqueadoManual) return "bloqueado";
  const today = new Date().toISOString().slice(0, 10);
  if (client.fechaVencimiento < today) return "vencido";
  const diffDays = Math.round((new Date(client.fechaVencimiento) - new Date(today)) / 86400000);
  return diffDays <= 3 ? "por_vencer" : "al_dia";
}

function render() {
  if (myClient) {
    els.statusBlock.classList.remove("hidden");
    els.signupForm.classList.add("hidden");
    const estado = computeStatus(myClient);
    const tieneAcceso = estado === "al_dia" || estado === "por_vencer";

    els.statusPlan.textContent = myClient.planNombre || "Tu plan";
    els.statusBadge.textContent = STATUS_LABEL[estado];
    els.statusBadge.className = `badge ${estado}`;
    els.statusVenc.textContent = `Próximo vencimiento: ${myClient.fechaVencimiento} · ${formatMoney(myClient.monto)}`;

    els.accessGrid.classList.toggle("hidden", !tieneAcceso);
    els.paywall.classList.toggle("hidden", tieneAcceso);
    if (tieneAcceso) renderAccessGrid(myClient.servicios || []);

    els.renewBtn.classList.toggle("hidden", estado === "al_dia");
    els.renewBtn.onclick = () => startCheckout(myClient.planId, myClient.nombre, myClient.contacto);
  } else {
    els.statusBlock.classList.add("hidden");
    els.signupForm.classList.remove("hidden");
  }
}

function renderAccessGrid(servicios) {
  els.accessGrid.innerHTML = "";
  for (const servicio of servicios) {
    const link = PLATFORM_LINKS[servicio] || { url: "#", color: "#6b7280" };
    const card = document.createElement("a");
    card.className = "platform-card";
    card.href = link.url;
    card.target = "_blank";
    card.rel = "noopener";
    card.style.setProperty("--platform-color", link.color);
    card.innerHTML = `<span class="platform-name">${escapeHtml(servicio)}</span><span class="platform-go">Entrar ›</span>`;
    els.accessGrid.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

els.signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await startCheckout(els.fieldPlan.value, els.fieldNombre.value.trim(), els.fieldContacto.value.trim());
});

async function startCheckout(planId, nombre, contacto) {
  els.signupError.textContent = "";
  const btn = myClient ? els.renewBtn : els.payBtn;
  btn.disabled = true;
  btn.textContent = "Conectando con Mercado Pago...";
  try {
    const callable = fb.httpsCallable(functions, "createCheckoutPreference");
    const result = await callable({ planId, nombre, contacto });
    window.location.href = result.data.initPoint;
  } catch (err) {
    els.signupError.textContent = err.message || "No se pudo iniciar el pago. Intenta de nuevo.";
    btn.disabled = false;
    btn.textContent = myClient ? "Renovar / pagar ahora" : "Pagar con Mercado Pago";
  }
}

init();
