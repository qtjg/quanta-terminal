#!/bin/bash
# RizzFloat APK build — no Gradle, no SDK manager: aapt2 + ecj + d8 + zipalign + apksigner
set -e
SDK=/home/z/my-project/android-sdk
BT=$SDK/android-13
AJ=$BT/android.jar
ECJ=$SDK/ecj.jar
PROJ=/home/z/my-project/android/RizzFloat
OUT_APK=/home/z/my-project/public/rizzfloat-v1.0.apk

cd "$PROJ"
rm -rf build gen classes
mkdir -p build gen classes build/dex

echo "[1/7] aapt2 compile resources..."
"$BT/aapt2" compile --dir res -o build/res.zip

echo "[2/7] aapt2 link..."
"$BT/aapt2" link -o build/base.apk -I "$AJ" \
  --manifest AndroidManifest.xml --java gen \
  --min-sdk-version 26 --target-sdk-version 33 \
  --version-code 1 --version-name 1.0 \
  --auto-add-overlay build/res.zip

echo "[3/7] ecj compile java..."
java -jar "$ECJ" -source 1.8 -target 1.8 -nowarn -cp "$AJ" -d classes \
  $(find gen src -name "*.java")

echo "[4/7] d8 dex..."
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --release \
  --lib "$AJ" --min-api 26 --output build/dex \
  $(find classes -name "*.class")

echo "[5/7] package dex into apk..."
(cd build/dex && zip -q -u ../base.apk classes.dex)

echo "[6/7] zipalign..."
"$BT/zipalign" -f 4 build/base.apk build/aligned.apk

if [ ! -f rizz.keystore ]; then
  echo "    generating keystore..."
  keytool -genkeypair -keystore rizz.keystore -alias rizz -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass rizzfloat -keypass rizzfloat \
    -dname "CN=RizzFloat, O=z, C=IN" >/dev/null 2>&1
fi

echo "[7/7] apksigner sign + verify..."
java -jar "$BT/lib/apksigner.jar" sign \
  --ks rizz.keystore --ks-pass pass:rizzfloat --key-pass pass:rizzfloat \
  --out "$OUT_APK" build/aligned.apk
java -jar "$BT/lib/apksigner.jar" verify --print-certs "$OUT_APK" | head -4

mkdir -p /home/z/my-project/download
cp "$OUT_APK" /home/z/my-project/download/rizzfloat-v1.0.apk
echo "DONE -> $OUT_APK"
ls -la "$OUT_APK"
