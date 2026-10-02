#!/usr/bin/env bash
# ==============================================================================
# VNV Bot V2 - Trình Khởi Động Tự Động Cho macOS (Apple Silicon & Intel)
# ==============================================================================
# Cách dùng: Nhấp đúp (Double-click) vào file này trên máy Mac để khởi động bot.
# ==============================================================================

# 1. Chuyển vào thư mục chứa mã nguồn của Bot
cd "$(cd "$(dirname "$0")" && pwd)"

echo "============================================================"
echo "    VNV BOT V2 - HỆ THỐNG QUẢN LÝ SỨ GIẢ (PHIÊN BẢN MACOS)"
echo "============================================================"

# Định vị thư mục gốc nếu người dùng kéo file ra ngoài
if [ ! -f "src/index.js" ]; then
    if [ -f "VNV-Bot-v2.0.0/src/index.js" ]; then
        cd "VNV-Bot-v2.0.0"
    elif [ -f "vnv_bot/src/index.js" ]; then
        cd "vnv_bot"
    fi
fi

if [ ! -f "src/index.js" ]; then
    echo "❌ Lỗi: Không tìm thấy thư mục 'src' chứa mã nguồn của Bot!"
    echo "Vui lòng mở file bên trong thư mục VNV-Bot sau khi đã giải nén."
    read -p "Nhấn Enter để đóng..."
    exit 1
fi

# 2. Nhận diện kiến trúc CPU của máy Mac (Apple Silicon arm64 hay Intel x86_64)
RAW_ARCH=$(uname -m)
if [ "$RAW_ARCH" = "arm64" ] || [ "$RAW_ARCH" = "aarch64" ]; then
    MAC_ARCH="arm64"
    echo "  🍏 Kiến trúc phần cứng: Apple Silicon ($RAW_ARCH - M1/M2/M3/M4)"
else
    MAC_ARCH="x64"
    echo "  💻 Kiến trúc phần cứng: Intel Mac ($RAW_ARCH)"
fi

mkdir -p bin

# 3. Đồng bộ thư viện C++ Native SQLite3 cho macOS (Mach-O)
echo "[1/3] Đang đồng bộ thư viện SQLite3 cho macOS ($MAC_ARCH)..."
SQLITE_SRC="bin/native/darwin-$MAC_ARCH/build/Release/node_sqlite3.node"
SQLITE_DEST1="node_modules/sqlite3/build/Release/node_sqlite3.node"
SQLITE_DEST2="node_modules/connect-sqlite3/node_modules/sqlite3/build/Release/node_sqlite3.node"

if [ -f "$SQLITE_SRC" ]; then
    mkdir -p "node_modules/sqlite3/build/Release"
    cp -f "$SQLITE_SRC" "$SQLITE_DEST1" 2>/dev/null
    if [ -d "node_modules/connect-sqlite3/node_modules/sqlite3" ]; then
        mkdir -p "node_modules/connect-sqlite3/node_modules/sqlite3/build/Release"
        cp -f "$SQLITE_SRC" "$SQLITE_DEST2" 2>/dev/null
    fi
    echo "  ✓ Thư viện SQLite3 macOS đã sẵn sàng!"
else
    # Fallback: Tự động tải prebuilt nếu chưa có sẵn trong bin/native
    echo "  [i] Đang tải thư viện SQLite3 prebuilt cho macOS..."
    NATIVE_URL="https://github.com/TryGhost/node-sqlite3/releases/download/v6.0.1/sqlite3-v6.0.1-napi-v6-darwin-$MAC_ARCH.tar.gz"
    TMP_SQLITE="/tmp/sqlite3_darwin.tar.gz"
    curl -sL "$NATIVE_URL" -o "$TMP_SQLITE"
    if [ -f "$TMP_SQLITE" ]; then
        mkdir -p "node_modules/sqlite3/build/Release"
        tar -xzf "$TMP_SQLITE" -C "node_modules/sqlite3/build"
        if [ -d "node_modules/connect-sqlite3/node_modules/sqlite3" ]; then
            mkdir -p "node_modules/connect-sqlite3/node_modules/sqlite3/build/Release"
            cp -f "$SQLITE_DEST1" "$SQLITE_DEST2" 2>/dev/null
        fi
        rm -f "$TMP_SQLITE"
        echo "  ✓ Tải và cài đặt SQLite3 macOS thành công!"
    fi
fi

# 4. Tìm kiếm hoặc tự động nạp môi trường Node.js runtime
echo "[2/3] Đang kiểm tra môi trường Node.js..."
NODE_EXE=""

# 4.1 Ưu tiên Node đóng gói sẵn trong thư mục bin/
if [ -f "bin/node" ]; then
    chmod +x "bin/node" 2>/dev/null
    if bin/node -v >/dev/null 2>&1; then
        NODE_EXE="bin/node"
    fi
fi

if [ -z "$NODE_EXE" ] && [ -f "bin/node-darwin-$MAC_ARCH" ]; then
    cp -f "bin/node-darwin-$MAC_ARCH" "bin/node"
    chmod +x "bin/node" 2>/dev/null
    if bin/node -v >/dev/null 2>&1; then
        NODE_EXE="bin/node"
    fi
fi

# 4.2 Kiểm tra Node.js đã cài sẵn trên macOS (PATH hoặc Homebrew)
if [ -z "$NODE_EXE" ]; then
    if command -v node >/dev/null 2>&1; then
        NODE_EXE="node"
    elif [ -x "/opt/homebrew/bin/node" ]; then
        NODE_EXE="/opt/homebrew/bin/node"
    elif [ -x "/usr/local/bin/node" ]; then
        NODE_EXE="/usr/local/bin/node"
    fi
fi

# 4.3 Nếu máy chưa hề có Node.js, tự động tải portable binary từ nodejs.org (chỉ 1 lần duy nhất)
if [ -z "$NODE_EXE" ]; then
    echo "  [!] Máy Mac chưa có Node.js runtime."
    echo "  [i] Đang tự động tải Node.js portable cho macOS $MAC_ARCH từ nodejs.org..."
    NODE_URL="https://nodejs.org/dist/v24.15.0/node-v24.15.0-darwin-$MAC_ARCH.tar.gz"
    TMP_TAR="/tmp/node_mac.tar.gz"
    curl -sL "$NODE_URL" -o "$TMP_TAR"
    if [ -f "$TMP_TAR" ]; then
        tar -xzf "$TMP_TAR" -C bin --strip-components=2 "node-v24.15.0-darwin-$MAC_ARCH/bin/node" 2>/dev/null
        rm -f "$TMP_TAR"
        chmod +x bin/node 2>/dev/null
        if [ -f "bin/node" ]; then
            NODE_EXE="bin/node"
            echo "  ✓ Tải Node.js cho macOS thành công!"
        fi
    fi
fi

if [ -z "$NODE_EXE" ]; then
    echo "❌ Lỗi: Không thể khởi động Node.js trên máy Mac của bạn."
    echo "Vui lòng cài đặt Node.js từ https://nodejs.org để tiếp tục."
    read -p "Nhấn Enter để đóng..."
    exit 1
fi

echo "  ✓ Node.js đã sẵn sàng: $("$NODE_EXE" -v)"

# 5. Giải phóng cổng 3000 nếu đang bị ứng dụng khác chiếm
lsof -ti:3000 | xargs kill -9 >/dev/null 2>&1

mkdir -p data logs backups

echo "[3/3] Đang khởi động VNV Bot V2..."
echo "============================================================"
echo "  Địa chỉ Dashboard: http://localhost:3000"
echo "  Trình duyệt sẽ tự động mở trong giây lát..."
echo "  Mẹo: Để dừng Bot, bạn chỉ cần đóng cửa sổ Terminal này (hoặc bấm Ctrl+C)."
echo "============================================================"

# 6. Khởi chạy máy chủ VNV Bot
exec "$NODE_EXE" src/index.js
