#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
JAVA_HOME=${JAVA_HOME:-'/Applications/Android Studio.app/Contents/jbr/Contents/Home'}
export JAVA_HOME
BUILD=$(mktemp -d /tmp/loka-party-check.XXXXXX)
trap 'rm -rf "$BUILD"' EXIT
"$ROOT/android/loka-mesh-lab/gradlew" -p "$ROOT/android/loka-mesh-lab" :core:jar >/dev/null
KOTLIN=$(find "$HOME/.gradle/caches/modules-2/files-2.1/org.jetbrains.kotlin/kotlin-stdlib" -name '*.jar' | sort | tail -1)
CP="$ROOT/android/loka-mesh-lab/core/build/libs/core.jar:$KOTLIN:$BUILD"
"$JAVA_HOME/bin/javac" -cp "$CP" -d "$BUILD" "$ROOT/ios/Tests/PartyInterop.java"
swiftc -module-cache-path "$BUILD/modules" "$ROOT/ios/Core/QuickQuiz.swift" "$ROOT/ios/Core/PartyCards.swift" "$ROOT/ios/Tests/PartyProtocolChecks.swift" -o "$BUILD/check"
"$BUILD/check" "$JAVA_HOME/bin/java" "$CP"
swiftc -module-cache-path "$BUILD/modules" "$ROOT/ios/Core/ContactIdentity.swift" "$ROOT/ios/Core/LokaProtocol.swift" "$ROOT/ios/Core/LokaMesh.swift" "$ROOT/ios/Core/ChatContent.swift" "$ROOT/ios/Core/ChatMessage.swift" "$ROOT/ios/Core/ContactConsent.swift" "$ROOT/ios/Core/EncounterHistory.swift" "$ROOT/ios/Features/MessageArchive.swift" "$ROOT/ios/Core/QuickQuiz.swift" "$ROOT/ios/Core/PartyCards.swift" "$ROOT/ios/Features/PartyCatalog.swift" "$ROOT/ios/Tests/PartyEnvelopeChecks.swift" -o "$BUILD/envelope"
"$BUILD/envelope" "$ROOT/gameJson/games.json"
