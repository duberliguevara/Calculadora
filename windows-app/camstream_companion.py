"""
CamStream Companion - conecta el celular (con la app CamStream) a la PC.

No procesa video. Solo:
  - Detecta el celular por USB via adb y hace el port-forward necesario.
  - Muestra la URL para pegar en OBS Studio (Fuente de Media) o en el
    "Navegador" de OBS, u otra app que acepte una URL de video MJPEG.
  - Recuerda: en OBS, tras agregar la fuente, usa "Iniciar Camara Virtual"
    para exponerla a Zoom, Teams, Discord, etc.
"""

import shutil
import subprocess
import tkinter as tk
from tkinter import messagebox, ttk

STREAM_PORT = 8080

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


class CompanionApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("CamStream Companion")
        self.root.geometry("520x360")
        self.root.resizable(False, False)

        self.adb_path = find_adb()

        pad = {"padx": 16, "pady": 8}

        title = ttk.Label(root, text="CamStream Companion", font=("Segoe UI", 16, "bold"))
        title.pack(**pad)

        subtitle = ttk.Label(
            root,
            text="Usa la cámara de tu celular como fuente en OBS Studio\n(o cualquier otro programa, vía la Cámara Virtual de OBS).",
            justify="center",
        )
        subtitle.pack(**pad)

        # --- USB section ---
        usb_frame = ttk.LabelFrame(root, text="Conexión por USB")
        usb_frame.pack(fill="x", **pad)

        self.usb_status = ttk.Label(usb_frame, text="Sin verificar")
        self.usb_status.pack(anchor="w", padx=8, pady=4)

        usb_button = ttk.Button(usb_frame, text="Conectar por USB", command=self.connect_usb)
        usb_button.pack(anchor="w", padx=8, pady=4)

        # --- WiFi section ---
        wifi_frame = ttk.LabelFrame(root, text="Conexión por WiFi")
        wifi_frame.pack(fill="x", **pad)

        ttk.Label(
            wifi_frame,
            text="Abre la app CamStream en el celular, presiona\n'Iniciar transmisión' y copia la IP que muestra ahí:",
        ).pack(anchor="w", padx=8, pady=4)

        entry_row = ttk.Frame(wifi_frame)
        entry_row.pack(fill="x", padx=8, pady=4)
        ttk.Label(entry_row, text="IP del celular:").pack(side="left")
        self.ip_entry = ttk.Entry(entry_row, width=20)
        self.ip_entry.pack(side="left", padx=8)
        ttk.Button(entry_row, text="Usar esta IP", command=self.use_wifi_ip).pack(side="left")

        # --- Result URL ---
        result_frame = ttk.LabelFrame(root, text="URL para OBS (Fuente de Media / Navegador)")
        result_frame.pack(fill="x", **pad)

        self.url_var = tk.StringVar(value="(sin conexión activa)")
        url_entry = ttk.Entry(result_frame, textvariable=self.url_var, state="readonly", width=50)
        url_entry.pack(side="left", padx=8, pady=8)
        ttk.Button(result_frame, text="Copiar", command=self.copy_url).pack(side="left")

        if not self.adb_path:
            self.usb_status.config(text="No se encontró adb.exe (revisa Android SDK platform-tools)")

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
        url = f"http://127.0.0.1:{STREAM_PORT}/video"
        self.url_var.set(url)

    def use_wifi_ip(self):
        ip = self.ip_entry.get().strip()
        if not ip:
            messagebox.showwarning("Falta la IP", "Escribe la IP que muestra la app en el celular.")
            return
        self.url_var.set(f"http://{ip}:{STREAM_PORT}/video")

    def copy_url(self):
        url = self.url_var.get()
        if not url or url.startswith("("):
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(url)
        messagebox.showinfo("Copiado", "URL copiada al portapapeles.")


if __name__ == "__main__":
    root = tk.Tk()
    CompanionApp(root)
    root.mainloop()
