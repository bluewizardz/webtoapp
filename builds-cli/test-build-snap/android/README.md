# Snap!

Android app wrapping https://snap.berkeley.edu/snap/snap.html

## Build Locally

1. Install Gradle (or use Android Studio)
2. Run: gradle wrapper
3. Run: ./gradlew assembleDebug

The built APKs will be in `app/build/outputs/apk/debug/`

## Build via GitHub Actions (Zero Cost Setup)

This project has been pre-configured with a GitHub Actions workflow to build your APK for free:
1. Initialize a Git repository in this directory.
2. Push the files to a new GitHub repository.
3. The APK will be built automatically on every push. You can find the downloadable APK in the "Actions" tab of your GitHub repository under the latest run.
