// Single source of truth for the Android toolchain.
//
// The generated project's Gradle wrapper, the hosted compiler in build-utils.js
// and the CI cache keys must all agree, otherwise an exported project builds with
// a different Gradle version than the one that produced the APK.

/** Gradle version used by the hosted build and written into the project wrapper. */
export const GRADLE_VERSION = "8.12.1";

export const GRADLE_DISTRIBUTION_URL = `https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`;

/** Android Gradle Plugin version declared by the generated project. */
export const AGP_VERSION = "8.9.1";

/** Oldest Gradle release supported by the Android Gradle Plugin above. */
export const AGP_MIN_GRADLE_VERSION = "8.11.1";

export const COMPILE_SDK = 35;
export const MIN_SDK = 24;
export const TARGET_SDK = 35;

/** AGP 8.9 requires JDK 17. */
export const JAVA_VERSION = 17;
