# CamStream

Convierte la cámara de tu celular Android en una fuente de video **real
(H.264, el mismo tipo de compresión que usa el celular al grabar)** para
**OBS Studio** — y, mediante la Cámara Virtual de OBS, en cualquier otra
app: Zoom, Teams, Discord, Chrome, etc. — por WiFi o por USB.

Deja elegir la cámara (frontal o cualquiera de las traseras: ultra
angular, principal, teleobjetivo) y la calidad (480p a 1080p60).

## Cómo funciona

```
[Celular] --RTMP push (H.264)--> [PC: MediaMTX] <--RTMP pull-- [OBS Studio]
```

El celular transmite video H.264 real (no fotos sueltas) a un pequeño
servidor de video que corre en tu PC (**MediaMTX**, incluido, no hay que
instalar nada aparte). OBS se conecta a ese mismo servidor como
espectador. La URL que usas en OBS es siempre la misma sin importar si el
celular está por WiFi o por USB: `rtmp://127.0.0.1:1935/camstream`.

## Estructura

- [`android-app/`](android-app/) — app Android (Kotlin), captura la
  cámara elegida, la codifica en H.264 con el encoder por hardware del
  celular, y la publica por RTMP.
- [`windows-app/`](windows-app/) — programa de escritorio (Python) que
  arranca el servidor de video local (MediaMTX, incluido en
  `windows-app/mediamtx/`), muestra la IP de la PC para WiFi, y hace la
  conexión por USB con `adb reverse`.

## 1. Instalar la app en el celular

Abre `android-app/` en **Android Studio**, conecta el celular y presiona
**Run**. También puedes compilar el APK desde terminal:

```bash
cd android-app
./gradlew assembleDebug
```

El APK queda en `android-app/app/build/outputs/apk/debug/app-debug.apk`.

## 2. Abrir el programa de PC

```bash
cd windows-app
python camstream_companion.py
```

Arranca el servidor de video automáticamente y te muestra la **IP de esta
PC**. Windows va a pedir permiso de firewall para `mediamtx.exe` la
primera vez — acéptalo, si no el celular no podrá conectarse por WiFi.

## 3. Configurar y transmitir desde el celular

1. Abre la app **CamStream**.
2. Elige **cámara** (frontal / ultra angular / principal / teleobjetivo)
   y **calidad**.
3. En **"IP de la PC"** escribe la IP que te mostró el programa de PC (se
   guarda, solo hay que escribirla una vez).
4. Presiona **"Iniciar transmisión"**. El estado cambia a "Conectando…" y
   luego "Transmitiendo en vivo"; en el programa de PC vas a ver "🟢
   Celular conectado y transmitiendo".

### Sin WiFi: por USB

1. Activa **Opciones de desarrollador → Depuración USB** y conecta el
   cable. Autoriza la conexión cuando el celular lo pida.
2. En el programa de PC, presiona **"Conectar por USB"**.
3. En la app del celular, pon `127.0.0.1` como IP de la PC (el cable hace
   de puente).

## 4. Agregarlo en OBS Studio

1. En OBS: **Fuentes → + → Fuente de Media**.
2. Desmarca "Archivo local" y pega: `rtmp://127.0.0.1:1935/camstream`.
3. Listo — video real, sin importar si es WiFi o USB.

## 5. Usarlo en cualquier otro programa (Zoom, Teams, Discord, etc.)

1. En OBS, con la fuente ya agregada: **Controles → Iniciar Cámara
   Virtual**.
2. En la otra app, selecciona **"OBS Virtual Camera"** como cámara.

## Calidad y cámaras

- Presets en la app: Baja (480p), Media (720p), Alta (1080p), Máxima
  (1080p60) — ver [`QualityPreset.kt`](android-app/app/src/main/java/com/camstream/app/QualityPreset.kt).
- Cambiar de cámara mientras transmites cambia en caliente (sin cortar la
  transmisión); cambiar de calidad reinicia la transmisión brevemente
  porque implica reconfigurar el encoder.
- Las lentes traseras se detectan y etiquetan automáticamente según su
  campo de visión (no hay API de Android para pedir "dame la ultra
  angular" directamente) — ver [`CameraCatalog.kt`](android-app/app/src/main/java/com/camstream/app/CameraCatalog.kt).

## Notas

- La app pide permiso de cámara y micrófono (el audio del celular se
  incluye en la transmisión).
- Todo viaja sin cifrar por tu red local o por cable — no lo expongas a
  Internet tal cual.
- `windows-app/mediamtx/` incluye el binario oficial de
  [MediaMTX](https://github.com/bluenviron/mediamtx) (licencia MIT), con
  solo RTMP y su API de control habilitados (RTSP/HLS/WebRTC/SRT
  desactivados en `mediamtx.yml` para minimizar avisos de firewall).
