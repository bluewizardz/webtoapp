package org.turbowarp.turbowarp;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import android.widget.ProgressBar;

public class MainActivity extends Activity {
    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        final boolean fullScreen = true;
        if (fullScreen) {
            getWindow().getDecorView().setSystemUiVisibility(
                android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
        
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        progressBar = findViewById(R.id.progressBar);
        
        webView.setBackgroundColor(0xFF09080F);
        
        final boolean enablePullToRefresh = false;
        final boolean showSpinner = true;
        final boolean showSplash = true;
        final int splashDuration = 2000;

        swipeRefresh.setEnabled(enablePullToRefresh);
        if (enablePullToRefresh) {
            swipeRefresh.setOnRefreshListener(new SwipeRefreshLayout.OnRefreshListener() {
                @Override
                public void onRefresh() {
                    webView.reload();
                }
            });
        }

        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setLoadWithOverviewMode(true);
        webSettings.setUseWideViewPort(true);
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        
        final String customUA = null;
        if (customUA != null && !customUA.trim().isEmpty()) {
            webSettings.setUserAgentString(customUA);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (showSpinner && !swipeRefresh.isRefreshing()) {
                    progressBar.setVisibility(android.view.View.VISIBLE);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (showSpinner) {
                    progressBar.setVisibility(android.view.View.GONE);
                }
                swipeRefresh.setRefreshing(false);
                
                if (showSplash) {
                    final android.view.View splash = findViewById(R.id.splashOverlay);
                    if (splash != null && splash.getVisibility() == android.view.View.VISIBLE) {
                        splash.animate()
                            .alpha(0f)
                            .setDuration(300)
                            .setListener(new android.animation.AnimatorListenerAdapter() {
                                @Override
                                public void onAnimationEnd(android.animation.Animator animation) {
                                    splash.setVisibility(android.view.View.GONE);
                                }
                            });
                    }
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                view.loadUrl(url);
                return true;
            }
        });

        webView.loadUrl("https://snap.berkeley.edu/snap/snap.html");
        
        if (showSplash) {
            new android.os.Handler().postDelayed(new Runnable() {
                @Override
                public void run() {
                    final android.view.View splash = findViewById(R.id.splashOverlay);
                    if (splash != null && splash.getVisibility() == android.view.View.VISIBLE) {
                        splash.animate()
                            .alpha(0f)
                            .setDuration(300)
                            .setListener(new android.animation.AnimatorListenerAdapter() {
                                @Override
                                public void onAnimationEnd(android.animation.Animator animation) {
                                    splash.setVisibility(android.view.View.GONE);
                                }
                            });
                    }
                }
            }, splashDuration);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}