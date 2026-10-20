"""Read-only Win32 measurements for native acceptance; no UI input is injected."""
import ctypes as c
from ctypes import wintypes as w
import json
import sys

if len(sys.argv) > 1 and sys.argv[1] == "--image":
    from PIL import Image

    image = Image.open(sys.argv[2]).convert("RGBA")
    print(json.dumps({"size": image.size, "background": image.getpixel((6, 200)), "corner": image.getpixel((0, 0))}))
    sys.exit(0)

user32 = c.WinDLL("user32", use_last_error=True)
user32.SetProcessDpiAwarenessContext.argtypes = [c.c_void_p]
user32.SetProcessDpiAwarenessContext(c.c_void_p(-4))
user32.GetWindowLongPtrW.argtypes = [w.HWND, c.c_int]
user32.GetWindowLongPtrW.restype = c.c_ssize_t
user32.GetDpiForWindow.argtypes = [w.HWND]
user32.GetDpiForWindow.restype = w.UINT
user32.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]
user32.GetWindowRect.argtypes = [w.HWND, c.POINTER(w.RECT)]
user32.GetClientRect.argtypes = [w.HWND, c.POINTER(w.RECT)]
user32.IsWindowVisible.argtypes = [w.HWND]
user32.IsIconic.argtypes = [w.HWND]
user32.GetCursorPos.argtypes = [c.POINTER(w.POINT)]
user32.GetForegroundWindow.restype = w.HWND


class MonitorInfo(c.Structure):
    _fields_ = [("cbSize", w.DWORD), ("monitor", w.RECT), ("work", w.RECT), ("flags", w.DWORD), ("device", w.WCHAR * 32)]


user32.GetMonitorInfoW.argtypes = [w.HMONITOR, c.POINTER(MonitorInfo)]
monitor_callback = c.WINFUNCTYPE(w.BOOL, w.HMONITOR, w.HDC, c.POINTER(w.RECT), w.LPARAM)
window_callback = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
user32.EnumDisplayMonitors.argtypes = [w.HDC, c.POINTER(w.RECT), monitor_callback, w.LPARAM]
user32.EnumWindows.argtypes = [window_callback, w.LPARAM]
shcore = c.WinDLL("shcore")
shcore.GetDpiForMonitor.argtypes = [w.HMONITOR, c.c_int, c.POINTER(w.UINT), c.POINTER(w.UINT)]
monitors = []


@monitor_callback
def inspect_monitor(handle, _dc, _rect, _data):
    info = MonitorInfo()
    info.cbSize = c.sizeof(info)
    user32.GetMonitorInfoW(handle, c.byref(info))
    dpi_x, dpi_y = w.UINT(), w.UINT()
    shcore.GetDpiForMonitor(handle, 0, c.byref(dpi_x), c.byref(dpi_y))
    monitors.append({"name": info.device, "primary": bool(info.flags & 1), "dpi": dpi_x.value,
                     "work": {"x": info.work.left, "y": info.work.top, "width": info.work.right - info.work.left, "height": info.work.bottom - info.work.top}})
    return True


user32.EnumDisplayMonitors(None, None, inspect_monitor, 0)
windows = []
target_pid = int(sys.argv[1])


@window_callback
def inspect_window(handle, _data):
    pid = w.DWORD()
    user32.GetWindowThreadProcessId(handle, c.byref(pid))
    if pid.value != target_pid:
        return True
    rect, client = w.RECT(), w.RECT()
    user32.GetWindowRect(handle, c.byref(rect))
    user32.GetClientRect(handle, c.byref(client))
    style = user32.GetWindowLongPtrW(handle, -16)
    ex_style = user32.GetWindowLongPtrW(handle, -20)
    if client.right == 0 or not user32.IsWindowVisible(handle):
        return True
    windows.append({"handle": handle, "x": rect.left, "y": rect.top, "width": rect.right - rect.left, "height": rect.bottom - rect.top,
                    "clientWidth": client.right, "clientHeight": client.bottom, "dpi": user32.GetDpiForWindow(handle),
                    "topmost": bool(ex_style & 0x8), "toolWindow": bool(ex_style & 0x80), "caption": bool(style & 0xC00000),
                    "resizable": bool(style & 0x40000), "minimized": bool(user32.IsIconic(handle))})
    return True


user32.EnumWindows(inspect_window, 0)
cursor = w.POINT()
user32.GetCursorPos(c.byref(cursor))
foreground_pid = w.DWORD()
user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), c.byref(foreground_pid))
print(json.dumps({"pid": target_pid, "windows": windows, "monitors": monitors, "cursor": {"x": cursor.x, "y": cursor.y}, "foregroundPid": foreground_pid.value}))
