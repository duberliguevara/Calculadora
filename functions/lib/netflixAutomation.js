"use strict";

const ACCOUNT_URL = "https://www.netflix.com/YourAccount";
const LOGIN_URL = "https://www.netflix.com/login";

/**
 * Netflix's markup changes often and uses obfuscated class names, so these
 * selectors were written from general knowledge of Netflix's login form and
 * are NOT verified against the live site (this automation was built without
 * network access to netflix.com). Expect to have to fix at least the account
 * page selectors the first time you run this for real — see README's
 * "Depurar el bot" section.
 */
const SELECTORS = {
  emailInput: 'input[name="userLoginId"], input[type="email"]',
  passwordInput: 'input[name="password"], input[type="password"]',
  loginSubmit: 'button[data-uia="login-submit-button"], button[type="submit"]',
};

async function screenshot(page, label, { debugDir, uploadFn } = {}) {
  try {
    const buffer = await page.screenshot({ fullPage: true });
    if (uploadFn) await uploadFn(buffer, label);
    if (debugDir) {
      const fs = require("fs");
      const path = require("path");
      fs.mkdirSync(debugDir, { recursive: true });
      fs.writeFileSync(path.join(debugDir, `${Date.now()}-${label}.png`), buffer);
    }
  } catch (err) {
    console.warn("No se pudo tomar captura de depuración:", err.message);
  }
}

/** True if the current page looks like a logged-in Netflix account page. */
async function isLoggedIn(page) {
  const url = page.url();
  if (url.includes("/login")) return false;
  const hasLoginForm = await page.$(SELECTORS.emailInput).then(Boolean).catch(() => false);
  return !hasLoginForm;
}

/** Returns true if the page looks like it's asking for extra human verification we can't automate. */
async function needsManualVerification(page) {
  const url = page.url().toLowerCase();
  if (/verify|verificacion|verifica|challenge|captcha|codigo/.test(url)) return true;
  const bodyText = await page
    .evaluate(() => document.body.innerText.toLowerCase())
    .catch(() => "");
  return /verification code|código de verificación|confirm it's you|verifica que eres tú|unusual activity|actividad inusual/.test(
    bodyText
  );
}

async function login(page, email, password, opts = {}) {
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2" });

  if (await isLoggedIn(page)) return { success: true };

  await page.waitForSelector(SELECTORS.emailInput, { timeout: 15000 });
  await page.type(SELECTORS.emailInput, email, { delay: 20 });
  await page.type(SELECTORS.passwordInput, password, { delay: 20 });
  await screenshot(page, "before-submit", opts);

  await Promise.all([
    page.click(SELECTORS.loginSubmit),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {}),
  ]);

  await screenshot(page, "after-submit", opts);

  if (await needsManualVerification(page)) {
    return {
      success: false,
      needsManualVerification: true,
      message:
        "Netflix está pidiendo verificación adicional (código/captcha). El bot no puede resolver esto: corre el login local de nuevo (npm run login-local) para renovar la sesión a mano.",
    };
  }

  const ok = await isLoggedIn(page);
  return ok
    ? { success: true }
    : { success: false, message: "No se pudo confirmar el inicio de sesión (revisa la captura after-submit)." };
}

/**
 * Finds the "Manage extra member" / "Miembro extra" section from the account
 * page by matching link/button text instead of a hardcoded URL, since that
 * URL has moved more than once as Netflix rolled out this feature.
 */
async function goToExtraMemberPage(page, opts = {}) {
  await page.goto(ACCOUNT_URL, { waitUntil: "networkidle2" });
  await screenshot(page, "account-page", opts);

  const linkHandle = await page.evaluateHandle(() => {
    const candidates = Array.from(document.querySelectorAll("a, button"));
    return candidates.find((el) =>
      /extra member|miembro extra|manage access|gestionar acceso/i.test(el.textContent || "")
    );
  });
  const link = linkHandle.asElement();
  if (!link) {
    return { success: false, message: 'No se encontró el enlace de "Miembro extra" en la página de cuenta.' };
  }

  await Promise.all([
    link.click(),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}),
  ]);
  await screenshot(page, "extra-member-page", opts);
  return { success: true };
}

/**
 * Removes the extra member matching `nombre` or `email` on the currently
 * loaded "manage extra member" page.
 */
async function removeExtraMember(page, { nombre, email }, opts = {}) {
  const nav = await goToExtraMemberPage(page, opts);
  if (!nav.success) return nav;

  const memberFound = await page.evaluate(
    (needleName, needleEmail) => {
      const norm = (s) => (s || "").toLowerCase().trim();
      const rows = Array.from(document.querySelectorAll("li, div"));
      const row = rows.find((el) => {
        const text = norm(el.textContent);
        return (
          text.length < 400 && // avoid matching huge wrapper containers
          ((needleName && text.includes(norm(needleName))) ||
            (needleEmail && text.includes(norm(needleEmail))))
        );
      });
      if (!row) return false;
      row.setAttribute("data-netflix-bot-target", "1");
      return true;
    },
    nombre,
    email
  );

  if (!memberFound) {
    return {
      success: false,
      message: `No se encontró a "${nombre || email}" en la lista de miembros extra (revisa la captura extra-member-page).`,
    };
  }

  const removeClicked = await page.evaluate(() => {
    const row = document.querySelector('[data-netflix-bot-target="1"]');
    if (!row) return false;
    const btn = Array.from(row.querySelectorAll("a, button")).find((el) =>
      /remove|eliminar|quitar|delete/i.test(el.textContent || "")
    );
    if (!btn) return false;
    btn.click();
    return true;
  });

  if (!removeClicked) {
    return {
      success: false,
      message: `Se encontró a "${nombre || email}" pero no el botón de eliminar en esa fila (revisa la captura y ajusta el selector).`,
    };
  }

  await new Promise((r) => setTimeout(r, 1500));
  await screenshot(page, "after-remove-click", opts);

  // Netflix likely shows a confirmation dialog; try the common confirm button texts.
  const confirmClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((el) =>
      /^(remove|eliminar|quitar|confirm|confirmar|yes|sí)$/i.test((el.textContent || "").trim())
    );
    if (!btn) return false;
    btn.click();
    return true;
  });

  await new Promise((r) => setTimeout(r, 1500));
  await screenshot(page, "after-confirm", opts);

  return { success: true, confirmedDialog: confirmClicked };
}

module.exports = {
  ACCOUNT_URL,
  LOGIN_URL,
  isLoggedIn,
  needsManualVerification,
  login,
  goToExtraMemberPage,
  removeExtraMember,
  screenshot,
};
