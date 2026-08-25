"use strict";
/**
 * Sube functions/netflix-session.local.json (generado por `npm run
 * login-local`) al documento privado de Firestore que usa el bot en la nube.
 *
 * Necesitas una clave de cuenta de servicio de tu proyecto Firebase:
 *   Firebase Console > Configuración del proyecto > Cuentas de servicio >
 *   Generar nueva clave privada.
 * Guárdala fuera del repo y apunta a ella:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/ruta/a/tu-clave.json npm run upload-session
 */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const SESSION_FILE = path.join(__dirname, "..", "netflix-session.local.json");

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    "Falta GOOGLE_APPLICATION_CREDENTIALS. Ver el comentario al inicio de este archivo."
  );
  process.exit(1);
}

if (!fs.existsSync(SESSION_FILE)) {
  console.error(`No existe ${SESSION_FILE}. Corre primero: npm run login-local`);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });

async function main() {
  const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  await admin.firestore().doc("system/netflixSession").set(data);
  console.log("Sesión subida a Firestore (system/netflixSession).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
