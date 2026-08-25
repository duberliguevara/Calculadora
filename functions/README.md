# Bot de retiro automático en Netflix (opcional, alto riesgo)

Lee esto completo antes de activar nada. Este bot inicia sesión en tu cuenta
real de Netflix y hace clic en "eliminar" por ti cuando marcas a alguien como
**Bloqueado** en la app. No es un servicio de Netflix ni usa ninguna API
oficial — automatiza el navegador exactamente como lo harías tú a mano.

## Riesgos que aceptas al usar esto

- **Viola los Términos de Uso de Netflix**, que prohíben el acceso
  automatizado/bots a la cuenta. Si Netflix lo detecta, puede pedir
  verificación adicional, suspender el inicio de sesión, o en el peor caso
  **cerrar la cuenta** — la misma cuenta de la que depende tu negocio.
- **Guarda el acceso a tu cuenta de Netflix en la nube**: la contraseña vive
  en Google Secret Manager (no en este repo, no en Firestore, no en el
  navegador) y la sesión iniciada (cookies) vive en un documento privado de
  Firestore. Si tu proyecto de Google Cloud se ve comprometido, quien sea
  que entre ahí tiene acceso a tu Netflix.
- **No fue probado contra Netflix real.** Se escribió sin acceso a internet
  hacia netflix.com, así que los selectores en `lib/netflixAutomation.js`
  son el mejor intento a partir de patrones conocidos de su sitio, no algo
  verificado en vivo. Es muy probable que tengas que ajustarlos la primera
  vez viendo en qué falla (ver "Depurar el bot" más abajo).
- Netflix cambia su interfaz con frecuencia. Este bot **se puede romper en
  cualquier momento** sin aviso, y cuando se rompe, el checklist manual de
  la app sigue ahí como respaldo — revísalo si un cliente bloqueado no se
  fue de tu cuenta.

Si después de leer esto prefieres no correr este riesgo, simplemente no
despliegues nada de esta carpeta: la app principal funciona igual de bien
sin ella, solo que el último paso lo haces tú a mano.

## 1. Requisitos en Firebase / Google Cloud

1. Tu proyecto de Firebase debe estar en el **plan Blaze** (pago por uso).
   Cloud Functions solo puede llamar a servicios externos (como
   netflix.com) en ese plan. El uso de este bot (unas pocas ejecuciones al
   mes) cuesta centavos, pero Blaze pide una tarjeta asociada.
2. En [Google Cloud Console](https://console.cloud.google.com), con tu
   proyecto seleccionado, habilita estas APIs (busca cada una y presiona
   "Habilitar"):
   - Cloud Functions API
   - Cloud Build API
   - Artifact Registry API
   - Secret Manager API
   - Cloud Storage (ya suele venir habilitado con Firebase)

## 2. Guardar tu contraseña de Netflix en Secret Manager

En Secret Manager, crea dos secrets:

- `netflix-email` → tu correo de Netflix.
- `netflix-password` → tu contraseña de Netflix.

Luego dale permiso de lectura a la cuenta de servicio que usan las Cloud
Functions (normalmente `PROJECT_NUMBER-compute@developer.gserviceaccount.com`;
la ves en IAM). Rol necesario: **Secret Manager Secret Accessor**.

## 3. Instalar Firebase CLI y conectar el proyecto

```bash
npm install -g firebase-tools
firebase login
firebase use --add   # elige tu proyecto; esto puede actualizar .firebaserc
```

Si `firebase use --add` no actualiza `.firebaserc` en la raíz del repo,
edítalo a mano y reemplaza `TU_PROYECTO_ID` por el ID real de tu proyecto.

## 4. Desplegar

```bash
cd functions
npm install
cd ..
firebase deploy --only functions,firestore:rules
```

## 5. Primer inicio de sesión (manual, una sola vez)

El bot reutiliza una sesión ya iniciada en vez de loguearse cada vez — así
evita disparar las alertas de "inicio de sesión inusual" de Netflix la
mayoría de las veces. Para crear esa sesión, tienes que iniciar sesión tú
mismo una vez, resolviendo cualquier verificación que pida Netflix (algo que
el bot nunca podrá hacer solo):

```bash
cd functions
npm install
npm run login-local
```

Se abre un Chrome visible. Inicia sesión normal, incluyendo cualquier código
que te pidan. Cuando cargue tu cuenta, el script guarda la sesión en
`functions/netflix-session.local.json` (este archivo está en `.gitignore`:
**nunca lo subas a git**, es equivalente a tu contraseña).

Después súbela a Firestore:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/ruta/a/tu-clave-de-servicio.json npm run upload-session
```

(Esa clave se descarga en Firebase Console → Configuración del proyecto →
Cuentas de servicio → Generar nueva clave privada. Guárdala fuera del repo.)

## 6. Uso diario

No tienes que hacer nada más: cuando presionas "Bloquear" en la app, se
dispara sola la función `removeNetflixExtraMember`. El resultado aparece en
la propia tarjeta del cliente bloqueado:

- 🤖 *intentando ahora* — en proceso.
- ✅ *ya lo retiró* — listo, no necesitas hacer nada.
- ⚠️ *no pudo* — muestra el motivo y el checklist manual de respaldo, más un
  botón "Reintentar automatización".

Si el motivo dice algo de verificación/captcha, repite el paso 5 (login
local) para renovar la sesión y luego usa "Reintentar automatización".

## Depurar el bot

- Logs: `firebase functions:log` o Firebase Console → Functions → Logs.
- Capturas de pantalla de cada paso (login, página de cuenta, página de
  miembro extra, después de hacer clic en eliminar) se guardan en Cloud
  Storage bajo `netflix-bot-debug/{clientId}/...` — revísalas para ver
  exactamente dónde se atoró.
- Si un selector no coincide con la página real de Netflix, ajusta
  `functions/lib/netflixAutomation.js` (los comentarios en `SELECTORS` y en
  `removeExtraMember` explican qué busca cada uno) y vuelve a desplegar con
  `firebase deploy --only functions`.
