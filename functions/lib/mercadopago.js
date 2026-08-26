"use strict";
/**
 * Llamadas mínimas a la API REST de Mercado Pago (Checkout Pro + pagos).
 * Escrito a partir de la documentación pública de Mercado Pago; no se pudo
 * probar contra la API real desde este entorno (sin acceso a internet hacia
 * api.mercadopago.com). Antes de confiar en esto en producción, haz una
 * compra de prueba completa y revisa functions:log si algo no cuadra.
 */

const API_BASE = "https://api.mercadopago.com";

async function createPreference(accessToken, { title, price, currency, externalReference, backUrls, notificationUrl }) {
  const res = await fetch(`${API_BASE}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [
        {
          title,
          quantity: 1,
          unit_price: price,
          currency_id: currency,
        },
      ],
      external_reference: externalReference,
      notification_url: notificationUrl,
      back_urls: backUrls,
      auto_return: "approved",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mercado Pago rechazó la creación de la preferencia (${res.status}): ${text}`);
  }

  return res.json();
}

async function getPayment(accessToken, paymentId) {
  const res = await fetch(`${API_BASE}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`No se pudo leer el pago ${paymentId} (${res.status}): ${text}`);
  }
  return res.json();
}

module.exports = { createPreference, getPayment };
