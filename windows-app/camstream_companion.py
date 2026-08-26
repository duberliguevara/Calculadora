"""
CamStream Companion - recibe el video H.264/RTMP que transmite el celular
(app CamStream) y lo deja disponible para OBS Studio en una URL fija.

Qué hace:
  - Arranca un mini servidor de video local (MediaMTX) que solo actúa de
    relevo: el celular le empuja el video (RTMP publish) y OBS lo toma de
    ahí (RTMP play) — por eso la URL para OBS es siempre la misma:
    rtmp://127.0.0.1:1935/camstream
  - Muestra la IP de esta PC, que hay que escribir una vez en la app del
    celular (pantalla "IP de la PC") para conectar por WiFi.
  - Para USB: hace `adb reverse` para que el celular pueda llegar al
    servidor por el cable aunque no haya WiFi.
  - Consulta el servidor cada 2s para mostrar si el celular ya está
    conectado y transmitiendo.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.request
from tkinter import messagebox, ttk

RTMP_PORT = 1935
API_PORT = 9997
STREAM_PATH = "camstream"
OBS_URL = f"rtmp://127.0.0.1:{RTMP_PORT}/{STREAM_PATH}"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MEDIAMTX_EXE = os.path.join(BASE_DIR, "mediamtx", "mediamtx.exe")
MEDIAMTX_CONFIG = os.path.join(BASE_DIR, "mediamtx", "mediamtx.yml")

CANDIDATE_ADB_PATHS = [
    "adb",
    r"C:\Users\PC\AppData\Local\Android\Sdk\platform-tools\adb.exe",
]


def find_adb() -> str | None:
    for candidate in CANDIDATE_ADB_PATHS:
        if shutil.which(candidate):
            return candidate
        if candidate.lower().endswith(".exe"):
            try:
                subprocess.run([candidate, "version"], capture_output=True, timeout=5)
                return candidate
            except (OSError, subprocess.TimeoutExpired):
                continue
    return None


def get_local_ip() -> str | None:
    """Best-effort LAN IP: no packet is actually sent, this just asks the OS
    which local address it would use to reach an outside host."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(1)
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return None


class MediaServer:
    """Wraps the bundled MediaMTX process (the local RTMP relay)."""

    def __init__(self):
        self.process: subprocess.Popen | None = None

    def start(self) -> str | None:
        if not os.path.isfile(MEDIAMTX_EXE):
            return f"No se encontró {MEDIAMTX_EXE}"
        try:
            creationflags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
            self.process = subprocess.Popen(
                [MEDIAMTX_EXE, MEDIAMTX_CONFIG],
                cwd=os.path.dirname(MEDIAMTX_EXE),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creationflags,
            )
            return None
        except OSError as exc:
            return str(exc)

    def is_alive(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def stop(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()


def phone_is_publishing() -> bool:
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{API_PORT}/v3/paths/get/{STREAM_PATH}")
        with urllib.request.urlopen(req, timeout=1) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return bool(data.get("ready"))
    except Exception:
        return False


class CompanionApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("CamStream Companion")
        self.root.geometry("520x480")
        self.root.resizable(False, False)

        self.adb_path = find_adb()
        self.media_server = MediaServer()
        self.local_ip = get_local_ip() or "(no detectada)"

        pad = {"padx": 16, "pady": 8}

        title = ttk.Label(root, text="CamStream Companion", font=("Segoe UI", 16, "bold"))
        title.pack(**pad)

        subtitle = ttk.Label(
            root,
            text="Video H.264 real desde tu celular a OBS Studio\n(o cualquier otro programa, vía la Cámara Virtual de OBS).",
            justify="center",
        )
        subtitle.pack(**pad)

        server_frame = ttk.LabelFrame(root, text="Servidor de video local")
        server_frame.pack(fill="x", **pad)

        self.server_status = ttk.Label(server_frame, text="Iniciando…")
        self.server_status.pack(anchor="w", padx=8, pady=(6, 2))

        self.conn_status = ttk.Label(server_frame, text="⚪ Esperando que el celular se conecte…")
        self.conn_status.pack(anchor="w", padx=8, pady=(0, 8))

        wifi_frame = ttk.LabelFrame(root, text="Conexión por WiFi")
        wifi_frame.pack(fill="x", **pad)

        ttk.Label(
            wifi_frame,
            text="En la app del celular, en 'IP de la PC' escribe:",
        ).pack(anchor="w", padx=8, pady=(6, 2))

        ip_row = ttk.Frame(wifi_frame)
        ip_row.pack(fill="x", padx=8, pady=(0, 8))
        self.ip_var = tk.StringVar(value=self.local_ip)
        ip_entry = ttk.Entry(ip_row, textvariable=self.ip_var, state="readonly", font=("Segoe UI", 12, "bold"))
        ip_entry.pack(side="left", fill="x", expand=True)
        ttk.Button(ip_row, text="Copiar", command=self.copy_ip).pack(side="left", padx=(8, 0))

        usb_frame = ttk.LabelFrame(root, text="Conexión por USB (alternativa sin WiFi)")
        usb_frame.pack(fill="x", **pad)

        self.usb_status = ttk.Label(usb_frame, text="Sin verificar")
        self.usb_status.pack(anchor="w", padx=8, pady=4)

        ttk.Button(usb_frame, text="Conectar por USB", command=self.connect_usb).pack(
            anchor="w", padx=8, pady=(0, 8)
        )

        result_frame = ttk.LabelFrame(root, text="URL para OBS (Fuente de Media)")
        result_frame.pack(fill="x", **pad)

        url_row = ttk.Frame(result_frame)
        url_row.pack(fill="x", padx=8, pady=8)
        self.url_var = tk.StringVar(value=OBS_URL)
        url_entry = ttk.Entry(url_row, textvariable=self.url_var, state="readonly", width=40)
        url_entry.pack(side="left", fill="x", expand=True)
        ttk.Button(url_row, text="Copiar", command=self.copy_url).pack(side="left", padx=(8, 0))

        if not self.adb_path:
            self.usb_status.config(text="No se encontró adb.exe (revisa Android SDK platform-tools)")

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self._start_server()
        self._poll_status()

    # --- server lifecycle ---

    def _start_server(self):
        error = self.media_server.start()
        if error:
            self.server_status.config(text=f"❌ No se pudo iniciar el servidor: {error}")
        else:
            self.server_status.config(text="🟢 Servidor de video corriendo")

    def _poll_status(self):
        if not self.media_server.is_alive():
            self.server_status.config(text="❌ El servidor de video se detuvo")
        elif phone_is_publishing():
            self.conn_status.config(text="🟢 Celular conectado y transmitiendo")
        else:
            self.conn_status.config(text="⚪ Esperando que el celular se conecte…")
        self.root.after(2000, self._poll_status)

    # --- USB ---

    def connect_usb(self):
        if not self.adb_path:
            messagebox.showerror("adb no encontrado", "No se encontró adb.exe. Instala Android SDK Platform-Tools.")
            return
        try:
            devices = subprocess.run(
                [self.adb_path, "devices"], capture_output=True, text=True, timeout=10
            ).stdout
        except Exception as exc:
            messagebox.showerror("Error", f"No se pudo ejecutar adb: {exc}")
            return

        lines = [l for l in devices.strip().splitlines()[1:] if l.strip()]
        if not lines:
            self.usb_status.config(text="Ningún dispositivo detectado. Conecta el cable y habilita depuración USB.")
            return

        device_line = lines[0]
        if "unauthorized" in device_line:
            self.usb_status.config(text="Autoriza la depuración USB en el celular y vuelve a intentar.")
            return

        try:
            subprocess.run(
                [self.adb_path, "reverse", f"tcp:{RTMP_PORT}", f"tcp:{RTMP_PORT}"],
                check=True, capture_output=True, text=True, timeout=10,
            )
        except subprocess.CalledProcessError as exc:
            messagebox.showerror("Error", f"Falló la conexión: {exc.stderr}")
            return

        self.usb_status.config(text="Conectado — en la app, pon '127.0.0.1' como IP de la PC.")

    # --- common ---

    def copy_ip(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.local_ip)

    def copy_url(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.url_var.get())
        messagebox.showinfo("Copiado", "URL copiada al portapapeles.")

    def _on_close(self):
        self.media_server.stop()
        self.root.destroy()


if __name__ == "__main__":
    if sys.platform != "win32":
        print("Este companion está pensado para Windows (usa mediamtx.exe y adb.exe de Windows).")
    root = tk.Tk()
    CompanionApp(root)
    root.mainloop()
