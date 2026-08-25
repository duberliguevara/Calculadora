# Gestor de Clientes Netflix

App web (PWA) para administrar los clientes a los que les vendes acceso al
"miembro extra" de tu cuenta de Netflix: quién pagó, cuándo vence, y cuáles
hay que bloquear cuando no pagan.

## Sobre el bloqueo

Netflix **no ofrece una API pública** para que una app externa quite el
acceso a un miembro extra específico. Esta app no puede (ni debe) automatizar
eso iniciando sesión en tu Netflix por su cuenta: sería inseguro y se
rompería con cualquier cambio en su sitio.

Lo que sí hace: cuando marcas a un cliente como **Bloqueado**, la app te
muestra un checklist con el paso manual real que debes hacer en
`netflix.com/account → Miembro extra` para completarlo. El resto (seguimiento
de pagos, vencimientos, recordatorios visuales) es 100% automático.

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
