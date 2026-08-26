"""
CamStream Companion - recibe el video H.264/RTMP que transmite el celular
(app CamStream) y lo deja disponible para OBS Studio en una URL fija.
También controla el celular a distancia (cámara/calidad/detener) para no
tener que agarrarlo durante el stream.

Todo es automático — nunca hay que escribir ninguna IP, ni en el celular
ni acá:
  - Arranca un mini servidor de video local (MediaMTX) que solo actúa de
    relevo: el celular le empuja el video (RTMP publish) y OBS lo toma de
    ahí (RTMP play) — por eso la URL para OBS es siempre la misma:
    rtmp://127.0.0.1:1935/camstream
  - Se anuncia por broadcast UDP en la red para que la app del celular
    detecte la IP de esta PC sola (WiFi).
  - Detecta el cable USB solo (sondea `adb devices` cada 2s) y configura
    `adb reverse`/`adb forward` sin que haya que apretar nada.
  - Detecta la IP del celular (vía la propia MediaMTX, que sabe quién le
    está publicando) y, una vez conectado, deja cambiar cámara/calidad o
    detener la transmisión sin tocar el teléfono.
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
CONTROL_PORT = 8090
PC_ANNOUNCE_PORT = 8091
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


class PcAnnouncer:
    """Broadcasts this PC's presence so the phone app fills in the IP by itself."""

    def __init__(self):
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _run(self):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        except OSError:
            return
        payload = json.dumps({"app": "camstream_pc"}).encode("utf-8")
        while not self._stop.is_set():
            try:
                sock.sendto(payload, ("255.255.255.255", PC_ANNOUNCE_PORT))
            except OSError:
                pass
            self._stop.wait(2.0)
        sock.close()


def api_get(path: str, port: int = API_PORT, timeout: float = 1.5):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def phone_is_publishing() -> bool:
    try:
        return bool(api_get(f"/v3/paths/get/{STREAM_PATH}").get("ready"))
    except Exception:
        return False


def get_phone_ip() -> str | None:
    """MediaMTX already knows who is publishing to it — no need to ask the
    user to type the phone's IP separately."""
    try:
        items = api_get("/v3/rtmpconns/list").get("items", [])
        for item in items:
            remote = item.get("remoteAddr", "")
            if ":" in remote:
                return remote.rsplit(":", 1)[0]
    except Exception:
        pass
    return None


def phone_control_get(phone_ip: str, path: str, timeout: float = 3.0):
    req = urllib.request.Request(f"http://{phone_ip}:{CONTROL_PORT}{path}")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


class CompanionApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("CamStream Companion")
        self.root.geometry("520x640")
        self.root.resizable(False, False)

        self.adb_path = find_adb()
        self.media_server = MediaServer()
        self.pc_announcer = PcAnnouncer()
        self.local_ip = get_local_ip() or "(no detectada)"

        self.phone_ip: str | None = None
        self.cameras: list[dict] = []
        self.qualities: list[dict] = []
        self._updating_controls = False  # guard against re-sending our own dropdown refreshes
        self._usb_configured = False  # avoid re-running adb reverse/forward every poll tick

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
            text="Esta PC se anuncia sola en la red — la app del celular\nla detecta automáticamente, no hay nada que escribir.",
        ).pack(anchor="w", padx=8, pady=(6, 2))

        ip_row = ttk.Frame(wifi_frame)
        ip_row.pack(fill="x", padx=8, pady=(0, 8))
        self.ip_var = tk.StringVar(value=self.local_ip)
        ip_entry = ttk.Entry(ip_row, textvariable=self.ip_var, state="readonly", font=("Segoe UI", 12, "bold"))
        ip_entry.pack(side="left", fill="x", expand=True)
        ttk.Button(ip_row, text="Copiar", command=self.copy_ip).pack(side="left", padx=(8, 0))

        usb_frame = ttk.LabelFrame(root, text="Conexión por USB (alternativa sin WiFi)")
        usb_frame.pack(fill="x", **pad)

        self.usb_status = ttk.Label(usb_frame, text="⚪ Sin cable conectado")
        self.usb_status.pack(anchor="w", padx=8, pady=(6, 8))

        control_frame = ttk.LabelFrame(root, text="Control remoto (sin tocar el celular)")
        control_frame.pack(fill="x", **pad)

        self.control_status = ttk.Label(control_frame, text="Conecta el celular para habilitar el control")
        self.control_status.pack(anchor="w", padx=8, pady=(6, 6))

        cam_row = ttk.Frame(control_frame)
        cam_row.pack(fill="x", padx=8, pady=4)
        ttk.Label(cam_row, text="Cámara:", width=10).pack(side="left")
        self.camera_var = tk.StringVar()
        self.camera_combo = ttk.Combobox(cam_row, textvariable=self.camera_var, state="disabled")
        self.camera_combo.pack(side="left", fill="x", expand=True)
        self.camera_combo.bind("<<ComboboxSelected>>", self._on_camera_selected)

        quality_row = ttk.Frame(control_frame)
        quality_row.pack(fill="x", padx=8, pady=4)
        ttk.Label(quality_row, text="Calidad:", width=10).pack(side="left")
        self.quality_var = tk.StringVar()
        self.quality_combo = ttk.Combobox(quality_row, textvariable=self.quality_var, state="disabled")
        self.quality_combo.pack(side="left", fill="x", expand=True)
        self.quality_combo.bind("<<ComboboxSelected>>", self._on_quality_selected)

        self.stop_button = ttk.Button(
            control_frame, text="Detener transmisión", command=self.remote_stop, state="disabled"
        )
        self.stop_button.pack(anchor="w", padx=8, pady=(4, 8))

        result_frame = ttk.LabelFrame(root, text="URL para OBS (Fuente de Media)")
        result_frame.pack(fill="x", **pad)

        url_row = ttk.Frame(result_frame)
        url_row.pack(fill="x", padx=8, pady=8)
        self.url_var = tk.StringVar(value=OBS_URL)
        url_entry = ttk.Entry(url_row, textvariable=self.url_var, state="readonly", width=40)
        url_entry.pack(side="left", fill="x", expand=True)
        ttk.Button(url_row, text="Copiar", command=self.copy_url).pack(side="left", padx=(8, 0))

        if not self.adb_path:
            self.usb_status.config(text="⚪ USB no disponible (no se encontró adb.exe)")

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self._start_server()
        self.pc_announcer.start()
        self._poll_status()
        if self.adb_path:
            self._poll_usb()

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
            threading.Thread(target=self._refresh_remote_control, daemon=True).start()
        else:
            self.conn_status.config(text="⚪ Esperando que el celular se conecte…")
            self.phone_ip = None
            self._set_controls_enabled(False)
        self.root.after(2000, self._poll_status)

    # --- remote control ---

    def _refresh_remote_control(self):
        phone_ip = get_phone_ip()
        if not phone_ip:
            return
        try:
            status = phone_control_get(phone_ip, "/status")
        except Exception:
            self.root.after(0, lambda: self._set_controls_enabled(False))
            return
        self.phone_ip = phone_ip
        self.root.after(0, lambda: self._apply_status(status))

    def _apply_status(self, status: dict):
        self.cameras = status.get("cameras", [])
        self.qualities = status.get("qualities", [])
        self._set_controls_enabled(True)
        self.control_status.config(text=f"🟢 Controlando celular en {self.phone_ip}")

        self._updating_controls = True
        try:
            camera_labels = [c["label"] for c in self.cameras]
            self.camera_combo["values"] = camera_labels
            current_camera = status.get("cameraId")
            match = next((c["label"] for c in self.cameras if c["id"] == current_camera), None)
            if match and self.camera_var.get() != match:
                self.camera_var.set(match)

            quality_labels = [q["label"] for q in self.qualities]
            self.quality_combo["values"] = quality_labels
            current_quality = status.get("qualityKey")
            match_q = next((q["label"] for q in self.qualities if q["key"] == current_quality), None)
            if match_q and self.quality_var.get() != match_q:
                self.quality_var.set(match_q)
        finally:
            self._updating_controls = False

    def _set_controls_enabled(self, enabled: bool):
        state = "readonly" if enabled else "disabled"
        self.camera_combo.config(state=state)
        self.quality_combo.config(state=state)
        self.stop_button.config(state="normal" if enabled else "disabled")
        if not enabled:
            self.control_status.config(text="Conecta el celular para habilitar el control")

    def _on_camera_selected(self, _event=None):
        if self._updating_controls or not self.phone_ip:
            return
        label = self.camera_var.get()
        camera = next((c for c in self.cameras if c["label"] == label), None)
        if not camera:
            return
        phone_ip = self.phone_ip
        threading.Thread(
            target=lambda: self._safe_control_call(phone_ip, f"/camera?id={camera['id']}"), daemon=True
        ).start()

    def _on_quality_selected(self, _event=None):
        if self._updating_controls or not self.phone_ip:
            return
        label = self.quality_var.get()
        quality = next((q for q in self.qualities if q["label"] == label), None)
        if not quality:
            return
        phone_ip = self.phone_ip
        threading.Thread(
            target=lambda: self._safe_control_call(phone_ip, f"/quality?key={quality['key']}"), daemon=True
        ).start()

    def remote_stop(self):
        if not self.phone_ip:
            return
        phone_ip = self.phone_ip
        threading.Thread(target=lambda: self._safe_control_call(phone_ip, "/stop"), daemon=True).start()

    def _safe_control_call(self, phone_ip: str, path: str):
        try:
            phone_control_get(phone_ip, path)
        except Exception:
            pass  # next status poll will reflect whatever actually happened

    # --- USB (fully automatic: no button, just polls adb every 2s) ---

    def _poll_usb(self):
        threading.Thread(target=self._check_usb_once, daemon=True).start()
        self.root.after(2000, self._poll_usb)

    def _check_usb_once(self):
        try:
            devices = subprocess.run(
                [self.adb_path, "devices"], capture_output=True, text=True, timeout=5
            ).stdout
        except Exception:
            return

        lines = [l for l in devices.strip().splitlines()[1:] if l.strip()]
        if not lines:
            self._usb_configured = False
            self.root.after(0, lambda: self.usb_status.config(text="⚪ Sin cable conectado"))
            return

        if "unauthorized" in lines[0]:
            self._usb_configured = False
            self.root.after(
                0, lambda: self.usb_status.config(text="🟡 Autoriza la depuración USB en el celular")
            )
            return

        if self._usb_configured:
            return  # already set up for this connection; nothing to do

        try:
            # reverse: lets the phone's RTMP push (phone -> 127.0.0.1:1935) reach our server.
            subprocess.run(
                [self.adb_path, "reverse", f"tcp:{RTMP_PORT}", f"tcp:{RTMP_PORT}"],
                check=True, capture_output=True, text=True, timeout=10,
            )
            # forward: the opposite direction, lets us (PC) reach the phone's control server.
            subprocess.run(
                [self.adb_path, "forward", f"tcp:{CONTROL_PORT}", f"tcp:{CONTROL_PORT}"],
                check=True, capture_output=True, text=True, timeout=10,
            )
        except subprocess.CalledProcessError:
            self.root.after(0, lambda: self.usb_status.config(text="🟡 Cable detectado, reintentando conexión…"))
            return

        self._usb_configured = True
        self.root.after(0, lambda: self.usb_status.config(text="🟢 Celular conectado por USB"))

    # --- common ---

    def copy_ip(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.local_ip)

    def copy_url(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.url_var.get())
        messagebox.showinfo("Copiado", "URL copiada al portapapeles.")

    def _on_close(self):
        self.pc_announcer.stop()
        self.media_server.stop()
        self.root.destroy()


INSTANCE_LOCK_PORT = 8093


def acquire_single_instance_lock() -> socket.socket | None:
    """Held for the app's whole lifetime. If the port's already taken, another
    copy (old or new) is running — binding fails immediately, no timeout."""
    try:
        lock_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        lock_socket.bind(("127.0.0.1", INSTANCE_LOCK_PORT))
        lock_socket.listen(1)
        return lock_socket
    except OSError:
        return None


if __name__ == "__main__":
    if sys.platform != "win32":
        print("Este companion está pensado para Windows (usa mediamtx.exe y adb.exe de Windows).")

    _lock = acquire_single_instance_lock()
    if _lock is None:
        tk.Tk().withdraw()
        messagebox.showwarning(
            "CamStream Companion ya está corriendo",
            "Ya hay una copia abierta (puede ser una ventana vieja escondida).\n\n"
            "Ciérrala desde la bandeja/barra de tareas, o abre el Administrador de "
            "tareas y termina cualquier proceso 'python' o 'mediamtx' suelto, antes "
            "de abrir una nueva.",
        )
        sys.exit(1)

    root = tk.Tk()
    CompanionApp(root)
    root.mainloop()
