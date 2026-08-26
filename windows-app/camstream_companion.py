"""
CamStream Companion - conecta el celular (con la app CamStream) a la PC.

No procesa video. Solo:
  - Escucha en la red WiFi los avisos que manda el celular mientras
    transmite (broadcast UDP) y los muestra en una lista, para conectar
    con un clic sin escribir la IP a mano.
  - Detecta el celular por USB via adb y hace el port-forward necesario.
  - Muestra la URL para pegar en OBS Studio (Fuente de Media) o en el
    "Navegador" de OBS, u otra app que acepte una URL de video MJPEG.
  - Recuerda: en OBS, tras agregar la fuente, usa "Iniciar Camara Virtual"
    para exponerla a Zoom, Teams, Discord, etc.
"""

import json
import shutil
import socket
import subprocess
import threading
import time
import tkinter as tk
from tkinter import messagebox, ttk

STREAM_PORT = 8080
DISCOVERY_PORT = 8081
DEVICE_TIMEOUT_SECONDS = 6  # if no broadcast in this long, assume it stopped streaming

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


class DiscoveryListener:
    """Listens for CamStream UDP broadcasts and keeps a live registry of senders."""

    def __init__(self):
        self._devices: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def snapshot(self) -> list[tuple[str, dict]]:
        now = time.time()
        with self._lock:
            stale = [ip for ip, info in self._devices.items() if now - info["last_seen"] > DEVICE_TIMEOUT_SECONDS]
            for ip in stale:
                del self._devices[ip]
            return sorted(self._devices.items())

    def _run(self):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("", DISCOVERY_PORT))
            sock.settimeout(1.0)
        except OSError:
            return  # port busy or blocked; the manual IP fallback still works

        while not self._stop.is_set():
            try:
                data, addr = sock.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                payload = json.loads(data.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                continue
            if payload.get("app") != "camstream":
                continue
            ip = addr[0]
            with self._lock:
                self._devices[ip] = {
                    "port": payload.get("port", STREAM_PORT),
                    "name": payload.get("name", "Android"),
                    "last_seen": time.time(),
                }
        sock.close()


class CompanionApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("CamStream Companion")
        self.root.geometry("520x520")
        self.root.resizable(False, False)

        self.adb_path = find_adb()
        self.discovery = DiscoveryListener()
        self.discovery.start()
        self._list_index_to_ip: list[str] = []

        pad = {"padx": 16, "pady": 8}

        title = ttk.Label(root, text="CamStream Companion", font=("Segoe UI", 16, "bold"))
        title.pack(**pad)

        subtitle = ttk.Label(
            root,
            text="Usa la cámara de tu celular como fuente en OBS Studio\n(o cualquier otro programa, vía la Cámara Virtual de OBS).",
            justify="center",
        )
        subtitle.pack(**pad)

        # --- WiFi auto-discovery section ---
        wifi_frame = ttk.LabelFrame(root, text="Celulares detectados en la red (WiFi)")
        wifi_frame.pack(fill="x", **pad)

        ttk.Label(
            wifi_frame,
            text="Abre la app CamStream en el celular y presiona 'Iniciar\ntransmisión' — debería aparecer aquí en unos segundos:",
        ).pack(anchor="w", padx=8, pady=(4, 0))

        self.device_listbox = tk.Listbox(wifi_frame, height=4)
        self.device_listbox.pack(fill="x", padx=8, pady=4)
        self.device_listbox.bind("<Double-Button-1>", lambda _e: self.use_selected_device())

        ttk.Button(wifi_frame, text="Usar seleccionado", command=self.use_selected_device).pack(
            anchor="w", padx=8, pady=(0, 4)
        )

        manual_row = ttk.Frame(wifi_frame)
        manual_row.pack(fill="x", padx=8, pady=(4, 8))
        ttk.Label(manual_row, text="¿No aparece? IP manual:").pack(side="left")
        self.ip_entry = ttk.Entry(manual_row, width=16)
        self.ip_entry.pack(side="left", padx=8)
        ttk.Button(manual_row, text="Usar esta IP", command=self.use_wifi_ip).pack(side="left")

        # --- USB section ---
        usb_frame = ttk.LabelFrame(root, text="Conexión por USB")
        usb_frame.pack(fill="x", **pad)

        self.usb_status = ttk.Label(usb_frame, text="Sin verificar")
        self.usb_status.pack(anchor="w", padx=8, pady=4)

        ttk.Button(usb_frame, text="Conectar por USB", command=self.connect_usb).pack(
            anchor="w", padx=8, pady=4
        )

        # --- Result URL ---
        result_frame = ttk.LabelFrame(root, text="URL para OBS (Fuente de Media / Navegador)")
        result_frame.pack(fill="x", **pad)

        self.url_var = tk.StringVar(value="(sin conexión activa)")
        url_entry = ttk.Entry(result_frame, textvariable=self.url_var, state="readonly", width=50)
        url_entry.pack(side="left", padx=8, pady=8)
        ttk.Button(result_frame, text="Copiar", command=self.copy_url).pack(side="left")

        if not self.adb_path:
            self.usb_status.config(text="No se encontró adb.exe (revisa Android SDK platform-tools)")

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self._refresh_device_list()

    # --- WiFi auto-discovery ---

    def _refresh_device_list(self):
        devices = self.discovery.snapshot()
        self.device_listbox.delete(0, tk.END)
        self._list_index_to_ip = []
        now = time.time()
        for ip, info in devices:
            age = int(now - info["last_seen"])
            self.device_listbox.insert(tk.END, f"{info['name']} — {ip}  (visto hace {age}s)")
            self._list_index_to_ip.append(ip)
        if not devices:
            self.device_listbox.insert(tk.END, "(ninguno por ahora — esperando transmisión...)")
        self.root.after(1000, self._refresh_device_list)

    def use_selected_device(self):
        selection = self.device_listbox.curselection()
        if not selection or not self._list_index_to_ip:
            messagebox.showwarning("Nada seleccionado", "Selecciona un celular de la lista primero.")
            return
        index = selection[0]
        if index >= len(self._list_index_to_ip):
            return
        ip = self._list_index_to_ip[index]
        devices = dict(self.discovery.snapshot())
        port = devices.get(ip, {}).get("port", STREAM_PORT)
        self.url_var.set(f"http://{ip}:{port}/video")

    def use_wifi_ip(self):
        ip = self.ip_entry.get().strip()
        if not ip:
            messagebox.showwarning("Falta la IP", "Escribe la IP que muestra la app en el celular.")
            return
        self.url_var.set(f"http://{ip}:{STREAM_PORT}/video")

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
                [self.adb_path, "forward", f"tcp:{STREAM_PORT}", f"tcp:{STREAM_PORT}"],
                check=True, capture_output=True, text=True, timeout=10,
            )
        except subprocess.CalledProcessError as exc:
            messagebox.showerror("Error", f"Falló el port-forward: {exc.stderr}")
            return

        self.usb_status.config(text="Conectado por USB — port-forward activo.")
        self.url_var.set(f"http://127.0.0.1:{STREAM_PORT}/video")

    # --- Common ---

    def copy_url(self):
        url = self.url_var.get()
        if not url or url.startswith("("):
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(url)
        messagebox.showinfo("Copiado", "URL copiada al portapapeles.")

    def _on_close(self):
        self.discovery.stop()
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    CompanionApp(root)
    root.mainloop()
