"use strict";
/**
 * Corre esto UNA VEZ (y cada vez que la sesión guardada deje de servir) desde
 * tu propia computadora, con internet normal:
 *
 *   cd functions
 *   npm install
 *   npm run login-local
 *
 * Abre un Chrome real y visible. Inicia sesión con tu cuenta de Netflix a
 * mano, incluyendo cualquier código de verificación o captcha que te pida
 * (esto es exactamente lo que el bot en la nube NO puede resolver por sí
 * solo). Cuando la página de tu cuenta cargue, el script guarda la sesión en
 * functions/netflix-session.local.json. Luego corre `npm run upload-session`
 * para subirla a Firestore y que el bot en la nube pueda usarla.
 */
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { LOGIN_URL, isLoggedIn } = require("../lib/netflixAutomation");

const OUTPUT_FILE = path.join(__dirname, "..", "netflix-session.local.json");
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos para que resuelvas verificación con calma

async function main() {
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = (await browser.pages())[0] || (await browser.newPage());

  await page.goto(LOGIN_URL, { waitUntil: "networkidle2" });
  console.log("\nInicia sesión en la ventana de Chrome que se abrió.");
  console.log("Este script espera hasta 10 minutos a que termines.\n");

  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    if (await isLoggedIn(page)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!(await isLoggedIn(page))) {
    console.error("No se detectó un inicio de sesión exitoso a tiempo. Intenta de nuevo.");
    await browser.close();
    process.exit(1);
  }

  const cookies = await page.cookies();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ cookies, savedAt: new Date().toISOString() }, null, 2));
  console.log(`\nSesión guardada en ${OUTPUT_FILE}`);
  console.log("Ahora corre: npm run upload-session\n");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
