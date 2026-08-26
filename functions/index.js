"use strict";

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");
const { login, isLoggedIn, removeExtraMember } = require("./lib/netflixAutomation");

admin.initializeApp();
setGlobalOptions({ region: "us-central1" });

const db = admin.firestore();
const secretClient = new SecretManagerServiceClient();

// Nombres de los secrets en Google Secret Manager (ver README para crearlos).
const SECRET_EMAIL = process.env.NETFLIX_EMAIL_SECRET || "netflix-email";
const SECRET_PASSWORD = process.env.NETFLIX_PASSWORD_SECRET || "netflix-password";

async function readSecret(name) {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  const [version] = await secretClient.accessSecretVersion({
    name: `projects/${projectId}/secrets/${name}/versions/latest`,
  });
  return version.payload.data.toString("utf8");
}

async function uploadDebugScreenshot(clientId, buffer, label) {
  try {
    const bucket = admin.storage().bucket();
    const filePath = `netflix-bot-debug/${clientId}/${Date.now()}-${label}.png`;
    const file = bucket.file(filePath);
    await file.save(buffer, { contentType: "image/png" });
    return filePath;
  } catch (err) {
    console.warn("No se pudo subir la captura de depuración:", err.message);
    return null;
  }
}

async function launchBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
}

async function runRemoval(clientId, client) {
  const sessionRef = db.doc("system/netflixSession");
  const sessionSnap = await sessionRef.get();
  const savedCookies = sessionSnap.exists ? sessionSnap.data().cookies || [] : [];

  const browser = await launchBrowser();
  let lastDebugPath = null;
  const opts = {
    uploadFn: async (buffer, label) => {
      lastDebugPath = (await uploadDebugScreenshot(clientId, buffer, label)) || lastDebugPath;
    },
  };

  try {
    const page = await browser.newPage();
    if (savedCookies.length) {
      await page.setCookie(...savedCookies);
    }
    await page.goto("https://www.netflix.com/YourAccount", { waitUntil: "networkidle2" });

    if (!(await isLoggedIn(page))) {
      const email = await readSecret(SECRET_EMAIL);
      const password = await readSecret(SECRET_PASSWORD);
      const loginResult = await login(page, email, password, opts);
      if (!loginResult.success) {
        return { success: false, message: loginResult.message, debugPath: lastDebugPath };
      }
    }

    const result = await removeExtraMember(
      page,
      { nombre: client.nombre, email: client.emailNetflix },
      opts
    );

    const freshCookies = await page.cookies();
    await sessionRef.set({ cookies: freshCookies, savedAt: new Date().toISOString() });

    return { ...result, debugPath: lastDebugPath };
  } finally {
    await browser.close();
  }
}

exports.removeNetflixExtraMember = onDocumentUpdated(
  { document: "clients/{clientId}", memory: "1GiB", timeoutSeconds: 300 },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const clientId = event.params.clientId;

    const justBlocked = !before.bloqueadoManual && after.bloqueadoManual;
    const retryRequested =
      before.netflixRemovalStatus !== "pending" && after.netflixRemovalStatus === "pending";
    const incluyeNetflix = Array.isArray(after.servicios) && after.servicios.includes("Netflix");

    if (!after.bloqueadoManual || !incluyeNetflix || (!justBlocked && !retryRequested)) {
      return;
    }

    const clientRef = db.doc(`clients/${clientId}`);
    await clientRef.update({
      netflixRemovalStatus: "in_progress",
      netflixRemovalMessage: admin.firestore.FieldValue.delete(),
      netflixRemovalUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
      const result = await runRemoval(clientId, after);
      await clientRef.update({
        netflixRemovalStatus: result.success ? "done" : "failed",
        netflixRemovalMessage: result.message || (result.success ? "Retirado automáticamente." : ""),
        netflixRemovalDebugPath: result.debugPath || admin.firestore.FieldValue.delete(),
        netflixRemovalUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error("Fallo el bot de Netflix:", err);
      await clientRef.update({
        netflixRemovalStatus: "failed",
        netflixRemovalMessage: `Error inesperado: ${err.message}`,
        netflixRemovalUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);
