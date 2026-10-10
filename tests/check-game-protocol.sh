#!/bin/sh
set -eu
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"
java_root=${JAVA_HOME:-"/Applications/Android Studio.app/Contents/jbr/Contents/Home"}
stdlib_path=$(rg --files "${GRADLE_USER_HOME:-$HOME/.gradle}/caches/modules-2/files-2.1/org.jetbrains.kotlin/kotlin-stdlib" | rg '/kotlin-stdlib-[0-9][^/]*\.jar$' | head -n 1)
test_dir=$(mktemp -d /tmp/loka-game-checks.XXXXXX)
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM
classpath="$test_dir/java:$repo_dir/android/loka-mesh-lab/core/build/classes/kotlin/main:$stdlib_path"
"$java_root/bin/javac" -cp "$classpath" -d "$test_dir/java" ios/Tests/GameInterop.java
xcrun swiftc -module-cache-path /tmp/loka-quiz-module-cache ios/Core/QuickQuiz.swift ios/Tests/GameProtocolChecks.swift -o "$test_dir/checks"
"$test_dir/checks" "$java_root/bin/java" "$classpath"
xcrun swiftc -module-cache-path /tmp/loka-quiz-module-cache ios/Core/QuickQuiz.swift ios/Core/ContactIdentity.swift ios/Core/LokaProtocol.swift ios/Core/ChatContent.swift ios/Core/ChatMessage.swift ios/Core/ContactConsent.swift ios/Core/EncounterHistory.swift ios/Features/MessageArchive.swift ios/Tests/GameEnvelopeChecks.swift -o "$test_dir/envelope-checks"
"$test_dir/envelope-checks"
python3 tests/check-game-catalog.py
