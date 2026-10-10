#!/bin/sh
set -eu

# Run from any directory on a Mac with Xcode and JDK 17+.
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"
java_root=${JAVA_HOME:-"/Applications/Android Studio.app/Contents/jbr/Contents/Home"}
stdlib_path=$(rg --files "${GRADLE_USER_HOME:-$HOME/.gradle}/caches/modules-2/files-2.1/org.jetbrains.kotlin/kotlin-stdlib" | rg '/kotlin-stdlib-[0-9][^/]*\.jar$' | head -n 1)
test_dir=$(mktemp -d /tmp/loka-message-checks.XXXXXX)
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM

xcrun swiftc ios/Core/EncounterHistory.swift ios/Tests/EncounterHistoryChecks.swift -o "$test_dir/encounter-checks"
"$test_dir/encounter-checks"

if [ ! -d android/loka-mesh-lab/core/build/classes/kotlin/main ] || [ -z "$stdlib_path" ]; then
    echo 'Build the Android core first: cd android/loka-mesh-lab && ./gradlew :core:classes' >&2
    exit 1
fi
test_classpath="$test_dir/java:$repo_dir/android/loka-mesh-lab/core/build/classes/kotlin/main:$stdlib_path"
"$java_root/bin/javac" -cp "$test_classpath" -d "$test_dir/java" ios/Tests/JavaInterop.java
xcrun swiftc ios/Core/ContactIdentity.swift ios/Core/LokaProtocol.swift ios/Core/LokaMesh.swift ios/Core/ChatContent.swift ios/Core/ContactConsent.swift ios/Tests/MessageProtocolChecks.swift -o "$test_dir/checks"
"$test_dir/checks" "$java_root/bin/java" "$test_classpath"
xcrun swiftc ios/Core/ContactIdentity.swift ios/Core/LokaProtocol.swift ios/Core/LokaMesh.swift ios/Core/ChatContent.swift ios/Core/ChatMessage.swift ios/Core/ContactConsent.swift ios/Core/EncounterHistory.swift ios/Features/MessageArchive.swift ios/Tests/CarryProtocolChecks.swift -o "$test_dir/carry-checks"
"$test_dir/carry-checks" "$java_root/bin/java" "$test_classpath"
xcrun swiftc ios/Core/ContactIdentity.swift ios/Core/LokaProtocol.swift ios/Core/ContactQrCodec.swift ios/Tests/ContactCodeChecks.swift -o "$test_dir/contact-checks"
"$test_dir/contact-checks"
xcrun swiftc ios/Network/BleFraming.swift ios/Tests/BleFramingChecks.swift -o "$test_dir/framing-checks"
"$test_dir/framing-checks"
xcrun swiftc ios/Core/ContactIdentity.swift ios/Core/LokaProtocol.swift ios/Core/ChatContent.swift ios/Core/ChatMessage.swift ios/Core/ContactConsent.swift ios/Core/EncounterHistory.swift ios/Features/MessageArchive.swift ios/Tests/ChatContentChecks.swift -o "$test_dir/chat-checks"
"$test_dir/chat-checks"
xcrun swiftc ios/Core/ContactIdentity.swift ios/Core/LokaProtocol.swift ios/Core/ContactConsent.swift ios/Tests/ContactConsentChecks.swift -o "$test_dir/consent-checks"
"$test_dir/consent-checks"
xcrun swiftc ios/Core/ContactIdentity.swift ios/Core/LokaProtocol.swift ios/Core/ContactConsent.swift ios/Tests/NearbyPeopleChecks.swift -o "$test_dir/nearby-checks"
"$test_dir/nearby-checks" "$java_root/bin/java" "$test_classpath"

xcrun swiftc ios/Core/ContactIdentity.swift ios/Core/LokaProtocol.swift ios/Core/LokaMesh.swift ios/Core/ChatContent.swift ios/Tests/MultiCarryChecks.swift -o "$test_dir/multi-checks"
"$test_dir/multi-checks" "$java_root/bin/java" "$test_classpath"

xcrun swiftc ios/Core/CommunitySharingPreferences.swift ios/Tests/CommunitySharingChecks.swift -o "$test_dir/sharing-checks"
"$test_dir/sharing-checks"
