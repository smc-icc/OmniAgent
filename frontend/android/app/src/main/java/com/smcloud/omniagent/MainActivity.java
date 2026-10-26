package com.smcloud.omniagent;

import android.content.Context;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapacitorWebView;
import com.getcapacitor.android.R;

public class MainActivity extends BridgeActivity {
    @Override
    public void setContentView(int layoutResId) {
        super.setContentView(layoutResId);
        if (layoutResId != R.layout.capacitor_bridge_layout_main) {
            return;
        }

        // BridgeActivity inflates this layout before attaching the bridge.
        WebView original = findViewById(R.id.webview);
        ViewGroup parent = (ViewGroup) original.getParent();
        int index = parent.indexOfChild(original);
        CapacitorWebView webView = new StartupWebView(this);
        webView.setId(original.getId());
        ViewGroup.LayoutParams layoutParams = original.getLayoutParams();
        parent.removeView(original);
        parent.addView(webView, index, layoutParams);
        original.destroy();
    }

    private static final class StartupWebView extends CapacitorWebView {
        StartupWebView(Context context) {
            super(context, null);
        }

        @Override
        public void evaluateJavascript(String script, ValueCallback<String> resultCallback) {
            // Cordova may emit pause while the first document is still loading.
            // Check in that document at evaluation time; keep native lifecycle
            // callbacks immediate and discard events with no JS bridge to receive them.
            if (script != null && script.startsWith("window.Capacitor.triggerEvent(")) {
                script = "if (window.Capacitor && typeof window.Capacitor.triggerEvent === 'function') { "
                    + script + "; }";
            }
            super.evaluateJavascript(script, resultCallback);
        }
    }
}
