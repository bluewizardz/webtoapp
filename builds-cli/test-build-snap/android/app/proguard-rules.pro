# WebView
-keepclassmembers class * {
    public void onEvent*(**);
}

-keep class android.webkit.** { *; }
