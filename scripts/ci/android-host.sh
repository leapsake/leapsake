#!/usr/bin/env bash
# Prepares a hosted Linux runner for the Android device tiers: KVM for an accelerated
# emulator, the system image, and one AVD for the harness to boot.
set -euo pipefail

API=36
IMAGE="system-images;android-${API};google_apis;x86_64"

echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' |
  sudo tee /etc/udev/rules.d/99-kvm4all.rules >/dev/null
sudo udevadm control --reload-rules
sudo udevadm trigger --name-match=kvm

bin="${ANDROID_HOME:?ANDROID_HOME is not set}/cmdline-tools/latest/bin"
yes | "$bin/sdkmanager" --licenses >/dev/null || true
"$bin/sdkmanager" --install "platform-tools" "emulator" "platforms;android-${API}" "$IMAGE" >/dev/null
echo no | "$bin/avdmanager" create avd --force --name ci --package "$IMAGE" --device pixel_6

echo "AVD ci on ${IMAGE}; cores $(nproc), memory $(free -g | awk '/Mem:/ {print $2}')G"
