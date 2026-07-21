"""
Yêu cầu cài đặt:
    pip install esptool littlefs-python

Cách dùng:
1. Tìm file default_8MB.csv trong PlatformIO
    Get-ChildItem -Path "$env:USERPROFILE\.platformio" -Recurse -Filter "default_8MB.csv" | Select-Object FullName

2. Mở file theo đường dẫn, lấy đúng Offset và Size của spiffs, dùng để chỉ định chính xác Offset và Size của phân vùng SPIFFS/LittleFS trên flash
    python scripts/pull_wifi_info.py --port COM7 --offset ..... --size .....

3. Sử dụng lệnh sau khi cấu hình mặc định đã phù hợp và hệ thống có thể đọc/mount filesystem thành công
    python scripts/pull_wifi_info.py --port COM7
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
OUTPUT_PATH = os.path.join(PROJECT_ROOT, "data", "wifi_info.json")

DEFAULT_OFFSET = "0x670000"
DEFAULT_SIZE = "0x180000"
DEFAULT_BAUD = "921600"

BLOCK_SIZE_CANDIDATES = [4096, 8192, 2048]


def run(cmd: list) -> None:
    print(">>", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr)
        sys.exit(result.returncode)


def try_mount(raw: bytes, size_int: int, block_size: int):
    try:
        import littlefs

        block_count = size_int // block_size
        fs = littlefs.LittleFS(block_size=block_size, block_count=block_count)
        fs.context.buffer = bytearray(raw)
        fs.mount()
        return fs
    except Exception:
        return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Kéo info.dat từ ESP32 LittleFS về data/wifi_info.json"
    )
    parser.add_argument("--port", required=True, help="Cổng serial, ví dụ COM7")
    parser.add_argument(
        "--baud",
        default=DEFAULT_BAUD,
        help=f"Tốc độ đọc flash (mặc định {DEFAULT_BAUD})",
    )
    parser.add_argument(
        "--offset",
        default=DEFAULT_OFFSET,
        help=f"Địa chỉ partition LittleFS (mặc định {DEFAULT_OFFSET})",
    )
    parser.add_argument(
        "--size",
        default=DEFAULT_SIZE,
        help=f"Kích thước partition (mặc định {DEFAULT_SIZE})",
    )
    args = parser.parse_args()

    try:
        import littlefs
    except ImportError:
        print("Thiếu thư viện: pip install littlefs-python")
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmpdir:
        fs_bin = os.path.join(tmpdir, "littlefs.bin")

        run(
            [
                sys.executable,
                "-m",
                "esptool",
                "--port",
                args.port,
                "--baud",
                args.baud,
                "read_flash",
                args.offset,
                args.size,
                fs_bin,
            ]
        )

        with open(fs_bin, "rb") as f:
            raw = f.read()

    size_int = int(args.size, 16)
    fs = None

    for bs in BLOCK_SIZE_CANDIDATES:
        fs = try_mount(raw, size_int, bs)
        if fs is not None:
            break

    if fs is None:
        print(
            "Không thể mount LittleFS image. Kiểm tra lại --offset và --size."
        )
        sys.exit(1)

    # Đọc danh sách WiFi
    try:
        with fs.open("/wifi_list.json", "r") as src:
            wifi_list = json.loads(src.read())
    except FileNotFoundError:
        print("Không tìm thấy danh sách WiFi đã lưu.")
        fs.unmount()
        os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
        with open(OUTPUT_PATH, "w", encoding="utf-8") as dst:
            dst.write("[]")
        sys.exit(1)

    # Đọc thông tin IP và SSID hiện tại
    sta_ip = ""
    current_ssid = ""
    try:
        with fs.open("/info.dat", "r") as src:
            info = json.loads(src.read())
            sta_ip = info.get("STA_IP", "")
            current_ssid = info.get("WIFI_SSID", "")
    except FileNotFoundError:
        pass

    # Unmount sau khi đã đọc xong dữ liệu
    fs.unmount()

    # Cập nhật IP cho đúng SSID đang kết nối
    for entry in wifi_list:
        entry["sta_ip"] = (
            sta_ip if entry.get("ssid") == current_ssid else ""
        )

    # Định dạng lại JSON đầu ra cho đẹp (thêm indent=4)
    content = json.dumps(wifi_list, ensure_ascii=False, indent=4)

    # Ghi dữ liệu ra file cấu hình
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as dst:
        dst.write(content)

    print(f"\nĐã lưu thông tin WiFi ở data/wifi_info.json")


if __name__ == "__main__":
    main()