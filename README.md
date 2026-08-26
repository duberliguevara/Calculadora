# Gestor de Clientes Streaming

App web (PWA) para administrar los clientes a los que les vendes acceso a
cuentas de streaming compartidas (Netflix, Disney+, HBO Max, etc., incluso
combos de varias juntas): quién pagó, cuándo vence, y cuáles hay que
bloquear cuando no pagan.

También incluye, en `portal/`, una página aparte donde tus clientes se
registran solos, pagan con Mercado Pago y ven su propio estado — ver
[`portal/README.md`](portal/README.md).

## Sobre el bloqueo

Netflix **no ofrece una API pública** para que una app externa quite el
acceso a un miembro extra específico. Por defecto, cuando marcas a un
cliente como **Bloqueado**, la app te muestra un checklist con el paso
manual que debes hacer en `netflix.com/account → Miembro extra`.

Este repo también incluye, en `functions/`, un **bot opcional** que
automatiza ese último paso iniciando sesión en tu Netflix real y haciendo el
retiro por ti. Es opcional a propósito — actívalo solo si aceptas los
riesgos que se explican en [`functions/README.md`](functions/README.md):
puede violar los Términos de Uso de Netflix (arriesgando que te bloqueen o
cierren la cuenta), requiere guardar el acceso a tu cuenta de Netflix en un
servidor, y no fue probado contra el sitio real de Netflix (se escribió sin
acceso a internet hacia netflix.com), así que es probable que necesites
ajustarlo tú mismo la primera vez.

El resto (seguimiento de pagos, vencimientos, recordatorios visuales) es
100% automático con o sin el bot.

## Cómo funciona

- Un único usuario administrador (tú) inicia sesión con correo/contraseña.
- Los datos de clientes se guardan en Firestore y se sincronizan en tiempo
  real entre todos tus dispositivos.
- El estado de cada cliente se calcula solo según la fecha de vencimiento:
  **Al día**, **Por vencer** (≤3 días), **Vencido**, o **Bloqueado** (manual).
- "Marcar pagado" mueve la fecha de vencimiento según el ciclo de cobro
  (30 días por defecto, editable por cliente) y desbloquea automáticamente.

## Configuración (una sola vez)

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com).
2. **Authentication** → pestaña *Sign-in method* → habilita **Correo
   electrónico/contraseña**.
3. **Authentication** → pestaña *Users* → **Add user**: crea tu usuario con tu
   correo y una contraseña segura. Esta app no tiene registro público a
   propósito; solo tú puedes entrar.
4. **Firestore Database** → **Crear base de datos** (modo producción, la
   región que prefieras).
5. En **Reglas** de Firestore, pega el contenido de `firestore.rules` de este
   repo y publica. Esto asegura que cada cuenta solo puede leer/escribir sus
   propios clientes.
6. **Configuración del proyecto** (ícono de engranaje) → *Tus apps* → agrega
   una app web (`</>`) → copia el objeto `firebaseConfig`.
7. Pega esos valores en `firebase-config.js` (en la raíz de este repo),
   reemplazando los placeholders.

## Ejecutar

Es una app estática, solo necesitas servirla con cualquier hosting o
servidor local (no abrir el `index.html` con `file://`, los módulos ES y el
service worker requieren `http(s)://`):

```bash
npx serve .
# o
python3 -m http.server 8080
```

Para publicarla de forma permanente puedes usar Firebase Hosting, GitHub
Pages, Netlify o Vercel — cualquiera sirve, ya que todo el backend vive en
Firebase Auth/Firestore.

## Estructura

- `index.html` — pantalla de login y de la app.
- `style.css` — estilos.
- `app.js` — lógica: autenticación, lectura/escritura en Firestore, cálculo
  de estados, render de la interfaz.
- `firebase-config.js` — credenciales de tu proyecto Firebase (edítalo).
- `firestore.rules` — reglas de seguridad a publicar en Firebase Console.
- `manifest.json` / `sw.js` — configuración PWA (instalable, funciona con
  caché de la app; los datos siempre requieren conexión).
- `functions/` — Cloud Functions: el bot opcional que automatiza el retiro
  en Netflix (ver [`functions/README.md`](functions/README.md) antes de
  activarlo) y las funciones de pago que usa el portal de clientes.
- `portal/` — página aparte para que los clientes se registren, paguen con
  Mercado Pago y vean su propio estado. Ver
  [`portal/README.md`](portal/README.md).
