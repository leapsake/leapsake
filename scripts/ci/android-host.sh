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
# avdmanager follows XDG_CONFIG_HOME when it is set; the emulator only looks in ~/.android.
mkdir -p "$HOME/.android/avd"
echo no | ANDROID_AVD_HOME="$HOME/.android/avd" "$bin/avdmanager" create avd --force \
  --name ci --package "$IMAGE" --device pixel_6

if ! "$ANDROID_HOME/emulator/emulator" -list-avds | grep -qx ci; then
  echo "the emulator does not list the AVD it was just given" >&2
  exit 1
fi
echo "AVD ci on ${IMAGE}; cores $(nproc), memory $(free -g | awk '/Mem:/ {print $2}')G"
