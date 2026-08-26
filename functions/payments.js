"use strict";

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { createPreference, getPayment } = require("./lib/mercadopago");

const SECRET_MP_TOKEN = process.env.MERCADOPAGO_TOKEN_SECRET || "mercadopago-access-token";
const CURRENCY = process.env.MERCADOPAGO_CURRENCY || "PEN";
const PORTAL_URL = process.env.PORTAL_URL || "";
const CICLO_DIAS_PORTAL = Number(process.env.PORTAL_CICLO_DIAS) || 30;

/**
 * Registra las funciones de pago. Recibe las piezas ya inicializadas en
 * index.js (admin SDK, Firestore, lector de secrets) para no duplicar la
 * inicialización de Firebase Admin.
 */
function registerPaymentFunctions({ admin, db, readSecret }) {
  const createCheckoutPreference = onCall({ region: "us-central1" }, async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión con Google.");
    }
    const { planId, nombre, contacto } = request.data || {};
    if (!planId || !nombre) {
      throw new HttpsError("invalid-argument", "Falta el plan o el nombre.");
    }

    const planSnap = await db.doc(`plans/${planId}`).get();
    if (!planSnap.exists) {
      throw new HttpsError("not-found", "Ese plan ya no está disponible.");
    }
    const plan = planSnap.data();

    const configSnap = await db.doc("system/config").get();
    const adminUid = configSnap.exists ? configSnap.data().adminUid : null;
    if (!adminUid) {
      throw new HttpsError(
        "failed-precondition",
        "El sistema todavía no tiene administrador configurado (falta system/config.adminUid en Firestore)."
      );
    }

    const checkoutRef = await db.collection("checkouts").add({
      uid: request.auth.uid,
      email: request.auth.token.email || null,
      nombre,
      contacto: contacto || "",
      planId,
      planNombre: plan.nombre,
      servicios: plan.servicios || [],
      precio: Number(plan.precio) || 0,
      adminUid,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    let preference;
    try {
      const accessToken = await readSecret(SECRET_MP_TOKEN);
      const base = PORTAL_URL.replace(/\/$/, "");
      preference = await createPreference(accessToken, {
        title: plan.nombre,
        price: Number(plan.precio) || 0,
        currency: CURRENCY,
        externalReference: checkoutRef.id,
        backUrls: base
          ? {
              success: `${base}/?pago=exito`,
              failure: `${base}/?pago=fallo`,
              pending: `${base}/?pago=pendiente`,
            }
          : undefined,
      });
    } catch (err) {
      console.error("Error creando preferencia de Mercado Pago:", err);
      await checkoutRef.update({ status: "error", error: err.message });
      throw new HttpsError("internal", "No se pudo iniciar el pago con Mercado Pago.");
    }

    await checkoutRef.update({ mpPreferenceId: preference.id });
    return { checkoutId: checkoutRef.id, initPoint: preference.init_point };
  });

  const mercadoPagoWebhook = onRequest({ region: "us-central1" }, async (req, res) => {
    try {
      const paymentId = req.query["data.id"] || req.query.id;
      const type = req.query.type || req.query.topic;
      if (type !== "payment" || !paymentId) {
        res.status(200).send("ignored");
        return;
      }

      const accessToken = await readSecret(SECRET_MP_TOKEN);
      const payment = await getPayment(accessToken, paymentId);
      const checkoutId = payment.external_reference;
      if (!checkoutId) {
        res.status(200).send("sin referencia");
        return;
      }

      const checkoutRef = db.doc(`checkouts/${checkoutId}`);
      const checkoutSnap = await checkoutRef.get();
      if (!checkoutSnap.exists) {
        res.status(200).send("checkout desconocido");
        return;
      }
      const checkout = checkoutSnap.data();

      if (payment.status !== "approved") {
        await checkoutRef.update({ status: payment.status, mpPaymentId: String(paymentId) });
        res.status(200).send("ok");
        return;
      }

      if (checkout.status === "paid") {
        // Notificación duplicada de Mercado Pago: no reactivar dos veces.
        res.status(200).send("ya procesado");
        return;
      }

      const today = new Date();
      const vencimiento = new Date(today);
      vencimiento.setDate(vencimiento.getDate() + CICLO_DIAS_PORTAL);
      const fechaVencimiento = vencimiento.toISOString().slice(0, 10);
      const fechaPago = today.toISOString().slice(0, 10);

      const existingQuery = await db
        .collection("clients")
        .where("customerUid", "==", checkout.uid)
        .where("ownerId", "==", checkout.adminUid)
        .limit(1)
        .get();

      if (!existingQuery.empty) {
        const clientDoc = existingQuery.docs[0];
        const historial = Array.isArray(clientDoc.data().historialPagos)
          ? clientDoc.data().historialPagos.slice(-11)
          : [];
        historial.push({ fecha: fechaPago, monto: checkout.precio });
        await clientDoc.ref.update({
          fechaVencimiento,
          bloqueadoManual: false,
          monto: checkout.precio,
          planId: checkout.planId,
          planNombre: checkout.planNombre,
          servicios: checkout.servicios,
          historialPagos: historial,
        });
      } else {
        await db.collection("clients").add({
          ownerId: checkout.adminUid,
          customerUid: checkout.uid,
          nombre: checkout.nombre,
          contacto: checkout.contacto || checkout.email || "",
          monto: checkout.precio,
          fechaVencimiento,
          cicloDias: CICLO_DIAS_PORTAL,
          planId: checkout.planId,
          planNombre: checkout.planNombre,
          servicios: checkout.servicios,
          credenciales: "",
          emailNetflix: "",
          bloqueadoManual: false,
          historialPagos: [{ fecha: fechaPago, monto: checkout.precio }],
          origen: "portal",
        });
      }

      await checkoutRef.update({ status: "paid", mpPaymentId: String(paymentId) });
      res.status(200).send("ok");
    } catch (err) {
      console.error("Error en el webhook de Mercado Pago:", err);
      res.status(500).send("error");
    }
  });

  return { createCheckoutPreference, mercadoPagoWebhook };
}

module.exports = { registerPaymentFunctions };
