#!/bin/sh
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "${GREEN}Installing peep...${NC}"

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Darwin)
        BINARY_NAME="peep-darwin"
        ;;
    Linux)
        if [ "$ARCH" = "x86_64" ]; then
            BINARY_NAME="peep-linux-x64"
        elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
            BINARY_NAME="peep-linux-arm64"
        else
            echo "${RED}Unsupported architecture: $ARCH${NC}"
            exit 1
        fi
        ;;
    *)
        echo "${RED}Unsupported OS: $OS${NC}"
        exit 1
        ;;
esac

# Get latest version from GitHub
echo "${YELLOW}Fetching latest version...${NC}"
LATEST_TAG=$(curl -sL "https://api.github.com/repos/devskale/peep/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)

if [ -z "$LATEST_TAG" ]; then
    echo "${RED}Failed to fetch latest version${NC}"
    exit 1
fi

echo "${GREEN}Latest version: $LATEST_TAG${NC}"

# Determine install location
if [ -w "/usr/local/bin" ]; then
    INSTALL_DIR="/usr/local/bin"
else
    INSTALL_DIR="$HOME/.local/bin"
    mkdir -p "$INSTALL_DIR"
fi

BINARY_URL="https://github.com/devskale/peep/releases/download/${LATEST_TAG}/${BINARY_NAME}"

echo "${YELLOW}Downloading from: $BINARY_URL${NC}"

# Download binary
curl -sL "$BINARY_URL" -o "$INSTALL_DIR/peep"
chmod +x "$INSTALL_DIR/peep"

echo "${GREEN}✓ Installed peep to $INSTALL_DIR/peep${NC}"

# Verify installation
"$INSTALL_DIR/peep" --version 2>/dev/null || echo "${YELLOW}Note: --version not available, but peep is installed${NC}"

echo ""
echo "${GREEN}Done!${NC}"
if [ "$INSTALL_DIR" = "$HOME/.local/bin" ]; then
    echo "Make sure $HOME/.local/bin is in your PATH"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\" >> ~/.bashrc"
fi
