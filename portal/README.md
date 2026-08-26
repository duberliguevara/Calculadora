# Portal de autoservicio para clientes

Página aparte (`portal/`) para que tus clientes se registren solos,
inicien sesión con su cuenta de Google, elijan un plan/combo y paguen con
Mercado Pago — sin que tengas que crearlos manualmente en la app de
administración.

A diferencia del bot de Netflix, esto **no es de alto riesgo**: Mercado
Pago es un procesador de pagos real, pensado exactamente para esto. Aun así,
no se pudo probar contra la API real de Mercado Pago desde este entorno (sin
acceso a internet hacia api.mercadopago.com), así que haz una compra de
prueba completa antes de anunciarlo a tus clientes.

## Cómo funciona

1. El cliente entra a `portal/`, inicia sesión con Google.
2. Si no tiene una cuenta activa todavía, elige un plan y sus datos de
   contacto, y presiona "Pagar con Mercado Pago". Lo manda a la página de
   pago de Mercado Pago (Checkout Pro) — ahí es donde mete su tarjeta;
   **tu app nunca ve ni guarda el número de tarjeta**, eso lo maneja
   Mercado Pago.
3. Cuando el pago se aprueba, Mercado Pago le avisa a tu Cloud Function
   (`mercadoPagoWebhook`), que crea o renueva automáticamente el registro
   del cliente en Firestore — el mismo que ves en tu app de administración.
4. El cliente puede volver a `portal/` en cualquier momento para ver su
   estado (al día / por vencer / vencido) y renovar antes de que se venza.

**Importante**: esto activa el pago de **un ciclo a la vez** (30 días por
defecto). No cobra automáticamente el siguiente mes solo — el cliente tiene
que volver a pagar cada vez. Un cobro recurrente de verdad (que se cobre
solo, mes a mes) es posible con la API de "Preapproval" (suscripciones) de
Mercado Pago, pero es más compleja de configurar; esto queda como una
mejora futura si la necesitas.

## Configuración

Necesitas haber desplegado ya las Cloud Functions (ver
`functions/README.md` para instalar Firebase CLI y el plan Blaze — aplica
igual aquí, no hace falta el bot de Netflix para usar el portal).

### 1. Cuenta de Mercado Pago

1. Entra a [mercadopago.com.pe/developers](https://www.mercadopago.com.pe/developers)
   con tu cuenta de Mercado Pago (o crea una para tu negocio).
2. Ve a **Tus integraciones** → crea una aplicación.
3. Copia las **credenciales de producción** → **Access Token**.
   (Mercado Pago también te da credenciales de prueba — úsalas primero para
   probar todo el flujo con tarjetas de prueba antes de pasar a producción.)

### 2. Guardar el Access Token en Secret Manager

En Google Cloud Console → Secret Manager, crea un secret llamado
`mercadopago-access-token` con el valor del Access Token. Dale permiso de
lectura (rol **Secret Manager Secret Accessor**) a la cuenta de servicio de
Cloud Functions, igual que hiciste para los secrets de Netflix.

### 3. Configurar el administrador

Las Cloud Functions necesitan saber cuál es tu usuario (el administrador)
para que los clientes que se registren solos queden visibles en tu app.

1. Firebase Console → Authentication → Users → copia tu **User UID** (el
   usuario que creaste para entrar a la app de administración).
2. Firebase Console → Firestore Database → **Iniciar colección** → nombre
   `system` → ID de documento `config` → agrega el campo `adminUid` (tipo
   string) con ese UID → Guardar.

(Este documento no es visible ni editable desde el navegador — las reglas
de Firestore lo bloquean a propósito; solo tú, desde la consola de Firebase,
y las Cloud Functions pueden tocarlo.)

### 4. Habilitar el dominio del portal para el login de Google

Firebase Console → Authentication → Settings → **Authorized domains** →
agrega el dominio donde publiques `portal/` (por ejemplo
`tu-usuario.github.io`), si no aparece ya en la lista.

### 5. Variables de entorno de las funciones

```bash
cd functions
cp .env.example .env
```

Edita `functions/.env` y pon la URL real donde vas a publicar `portal/`
(por ejemplo `https://tu-usuario.github.io/tu-repo/portal`) y la moneda
(`PEN` para Perú).

### 6. Desplegar

```bash
firebase deploy --only functions,firestore:rules
```

Al terminar, la terminal (o Firebase Console → Functions) te muestra la URL
pública de `mercadoPagoWebhook`, algo como
`https://mercadopagowebhook-xxxxx-uc.a.run.app`.

### 7. Configurar el webhook en Mercado Pago

En el panel de tu aplicación en Mercado Pago Developers, busca la sección
de **Webhooks / Notificaciones** y pega esa URL, suscrita al evento
`payment` (pagos).

### 8. Crear al menos un plan

Antes de que un cliente pueda pagar, necesitas al menos un plan creado
desde tu app de administración (botón "Planes y combos").

## Probar

1. Usa las credenciales de **prueba** de Mercado Pago primero (se generan
   junto a las de producción en el mismo panel), con una de sus
   [tarjetas de prueba](https://www.mercadopago.com.pe/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards).
2. Entra a `portal/`, inicia sesión con Google, elige un plan, paga con la
   tarjeta de prueba.
3. Confirma que el cliente aparece en tu app de administración con el plan
   y la fecha de vencimiento correctos.
4. Solo entonces cambia el secret `mercadopago-access-token` por el Access
   Token de **producción**.

## Depurar

- Logs: `firebase functions:log` (busca `createCheckoutPreference` y
  `mercadoPagoWebhook`) o Firebase Console → Functions → Logs.
- Si el pago se aprueba en Mercado Pago pero el cliente no aparece en tu
  app: revisa que el webhook esté bien configurado (paso 7) y que
  `system/config.adminUid` tenga tu UID correcto (paso 3).
