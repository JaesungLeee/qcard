#!/bin/sh
# 테스트용 APK를 만든다 (코드 없는 매니페스트 전용 앱, 버리는 테스트 키로 서명). 결과는 test/fixtures/에 커밋한다.
#   sh scripts/make-fixtures.sh            (Android SDK build-tools 36·platform 36 필요)
set -eu
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$SDK/build-tools/36.0.0"
JAR="$SDK/platforms/android-36/android.jar"
OUT="$(cd "$(dirname "$0")/.." && pwd)/test/fixtures"
WORK="$(mktemp -d)"

manifest() { # $1 minSdk
  cat > "$WORK/AndroidManifest.xml" <<XML
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.qcard.sample" android:versionCode="42" android:versionName="1.4.2">
  <uses-sdk android:minSdkVersion="$1" android:targetSdkVersion="36" />
  <application android:label="qcard sample" android:hasCode="false" />
</manifest>
XML
}
build() { # $1 minSdk $2 out
  manifest "$1"
  "$BT/aapt2" link --manifest "$WORK/AndroidManifest.xml" -I "$JAR" -o "$WORK/raw.apk"
  "$BT/zipalign" -f 4 "$WORK/raw.apk" "$2"
}

keytool -genkeypair -keystore "$WORK/test.jks" -storepass qcard-test -keypass qcard-test -alias test \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=qcard test" >/dev/null 2>&1
sign() { # $1 in $2 out, 나머지는 apksigner 옵션
  in="$1"; out="$2"; shift 2
  "$BT/apksigner" sign --ks "$WORK/test.jks" --ks-pass pass:qcard-test --ks-key-alias test "$@" --out "$out" "$in"
}

build 21 "$WORK/min21.apk"
build 24 "$WORK/min24.apk"
cp "$WORK/min21.apk" "$OUT/unsigned.apk"
sign "$WORK/min21.apk" "$OUT/signed-v1v2v3.apk"
sign "$WORK/min21.apk" "$OUT/signed-v1.apk" --v2-signing-enabled false --v3-signing-enabled false
sign "$WORK/min24.apk" "$OUT/signed-v2.apk" --v1-signing-enabled false --v3-signing-enabled false
rm -f "$OUT"/*.idsig
keytool -list -v -keystore "$WORK/test.jks" -storepass qcard-test -alias test | grep -E "SHA1:|SHA256:" > "$OUT/fingerprint.txt"
cat "$OUT/fingerprint.txt"
