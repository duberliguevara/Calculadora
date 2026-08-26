# CamStream

Convierte la cámara de tu celular Android en una fuente de video para
**OBS Studio** (y, mediante la Cámara Virtual de OBS, en cualquier otra
app: Zoom, Teams, Discord, Chrome, etc.), por WiFi o por USB.

No requiere instalar ningún driver de cámara virtual propio: el celular
transmite video en formato MJPEG por HTTP, y OBS lo consume directamente
como una **Fuente de Media**. Su función nativa **"Iniciar Cámara
Virtual"** es la que la hace disponible para el resto de tus programas.

## Estructura

- [`android-app/`](android-app/) — app Android (Kotlin + CameraX) que
  transmite la cámara del celular como MJPEG por `http://IP:8080/video`.
- [`windows-app/`](windows-app/) — programa de escritorio (Python) que
  detecta el celular por USB y arma el port-forward automáticamente, o te
  ayuda a armar la URL cuando usas WiFi.

## 1. Instalar la app en el celular

Abre `android-app/` en **Android Studio**, conecta el celular (o usa un
emulador) y presiona **Run**. También puedes compilar el APK desde
terminal:

```bash
cd android-app
./gradlew assembleDebug
```

El APK queda en `android-app/app/build/outputs/apk/debug/app-debug.apk`.
Instálalo en el celular (`adb install app-debug.apk`) o cópialo y ábrelo
directamente.

## 2. Transmitir por WiFi

1. Conecta el celular a la **misma red WiFi** que la PC.
2. Abre la app **CamStream** en el celular y presiona **"Iniciar
   transmisión"**. Acepta el permiso de cámara.
3. La app muestra una URL como `http://192.168.1.23:8080/video` — esa es
   la que usarás en OBS.

## 3. Transmitir por USB (alternativa, sin depender del WiFi)

1. Activa **Opciones de desarrollador → Depuración USB** en el celular y
   conéctalo por cable a la PC. Autoriza la conexión cuando el celular lo
   pida.
2. Abre la app CamStream en el celular y presiona **"Iniciar
   transmisión"**.
3. Corre el programa de PC:

   ```bash
   cd windows-app
   python camstream_companion.py
   ```

4. Presiona **"Conectar por USB"** — hace `adb forward` automáticamente y
   te da la URL `http://127.0.0.1:8080/video`.

## 4. Agregarlo en OBS Studio

1. En OBS: **Fuentes → + → Fuente de Media**.
2. Desmarca "Archivo local" y pega la URL (`http://IP:8080/video` o
   `http://127.0.0.1:8080/video` según el método).
3. Listo — ya ves la imagen del celular en OBS.

## 5. Usarlo en cualquier otro programa (Zoom, Teams, Discord, etc.)

1. En OBS, con la fuente ya agregada: **Controles → Iniciar Cámara
   Virtual**.
2. En la otra app, selecciona **"OBS Virtual Camera"** como cámara.

## Notas

- El video se transmite sin cifrar (HTTP plano) — pensado para uso en tu
  red local o por cable, no para exponerlo a Internet.
- Resolución por defecto: 640x480 a ~15 fps, pensado para estabilidad
  antes que máxima calidad. Se puede ajustar en
  [`MjpegStreamService.kt`](android-app/app/src/main/java/com/camstream/app/MjpegStreamService.kt).
