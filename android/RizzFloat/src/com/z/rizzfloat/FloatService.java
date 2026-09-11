package com.z.rizzfloat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.animation.ValueAnimator;

/**
 * RizzFloat — floating bubble overlay service.
 * Bubble: draggable, snaps to screen edges, tap = open RizzReply panel, long-press = stop.
 * Panel: dark rounded window with a WebView loading the RizzReply PWA.
 */
public class FloatService extends Service {

    public static final String WEB_URL =
            "https://preview-chat-e4ce03b0-621a-4e60-9074-8481e7bfe67b.space-z.ai/rizz";
    public static final String ACTION_STOP = "com.z.rizzfloat.STOP";
    public static final String PREFS = "rizzfloat";
    public static volatile boolean running = false;
    private static FloatService instance;

    private static final String CHANNEL_ID = "rizzfloat";
    private static final int NOTIF_ID = 42;
    private static final int[] SIZE_DP = {52, 66, 80}; // S / M / L

    private WindowManager wm;
    private TextView bubble;
    private ViewGroup panel;
    private WebView webView;
    private WindowManager.LayoutParams bubbleLp;
    private int bubbleSizePx;
    private boolean expanded = false;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        instance = this;
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        createChannel();
        startForeground(NOTIF_ID, buildNotification());
        bubbleSizePx = dp(sizeDp());
        addBubble();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    // ---------------------------------------------------------------- bubble

    private int sizeDp() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        int idx = p.getInt("sizeIdx", 1);
        return SIZE_DP[Math.max(0, Math.min(SIZE_DP.length - 1, idx))];
    }

    private void addBubble() {
        TextView circle = new TextView(this);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(0xFFF59E0B);
        bg.setStroke(dp(2), 0xFF78350F);
        circle.setBackground(bg);
        circle.setText("R");
        circle.setTextColor(0xFF1C1917);
        circle.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, Math.max(16, sizeDp() / 3));
        circle.setTypeface(Typeface.create("sans-serif-black", Typeface.BOLD));
        circle.setGravity(Gravity.CENTER);
        circle.setShadowLayer(dp(3), 0, dp(2), 0x66000000);

        bubbleLp = new WindowManager.LayoutParams(
                bubbleSizePx, bubbleSizePx,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        bubbleLp.gravity = Gravity.TOP | Gravity.START;

        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        int maxX = screenW() - bubbleSizePx;
        int maxY = screenH() - bubbleSizePx;
        bubbleLp.x = clamp(Math.round(p.getFloat("bx", maxX)), 0, maxX);
        bubbleLp.y = clamp(Math.round(p.getFloat("by", maxY / 2f)), dp(40), maxY);

        circle.setOnTouchListener(bubbleTouch);
        bubble = circle;
        wm.addView(bubble, bubbleLp);
    }

    private final View.OnTouchListener bubbleTouch = new View.OnTouchListener() {
        private final android.view.GestureDetector gd = new android.view.GestureDetector(
                FloatService.this,
                new android.view.GestureDetector.SimpleOnGestureListener() {
                    @Override
                    public boolean onSingleTapUp(MotionEvent e) {
                        togglePanel();
                        return true;
                    }

                    @Override
                    public void onLongPress(MotionEvent e) {
                        Toast.makeText(FloatService.this,
                                "RizzFloat stopped", Toast.LENGTH_SHORT).show();
                        stopSelf();
                    }
                });
        private int downX, downY, startLpX, startLpY;
        private boolean dragged;

        @Override
        public boolean onTouch(View v, MotionEvent event) {
            gd.onTouchEvent(event);
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    downX = (int) event.getRawX();
                    downY = (int) event.getRawY();
                    startLpX = bubbleLp.x;
                    startLpY = bubbleLp.y;
                    dragged = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    int dx = (int) event.getRawX() - downX;
                    int dy = (int) event.getRawY() - downY;
                    if (dragged || Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                        dragged = true;
                        bubbleLp.x = clamp(startLpX + dx, 0, screenW() - bubbleSizePx);
                        bubbleLp.y = clamp(startLpY + dy, 0, screenH() - bubbleSizePx);
                        try {
                            wm.updateViewLayout(bubble, bubbleLp);
                        } catch (Exception ignored) {
                        }
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (dragged) snapToEdge();
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    return true;
            }
            return false;
        }
    };

    private void snapToEdge() {
        int maxX = screenW() - bubbleSizePx;
        int target = (bubbleLp.x + bubbleSizePx / 2 <= screenW() / 2) ? 0 : maxX;
        ValueAnimator va = ValueAnimator.ofInt(bubbleLp.x, target);
        va.setDuration(220);
        va.setInterpolator(new DecelerateInterpolator());
        va.addUpdateListener(anim -> {
            bubbleLp.x = (Integer) anim.getAnimatedValue();
            try {
                wm.updateViewLayout(bubble, bubbleLp);
            } catch (Exception ignored) {
            }
        });
        va.start();
        vibrate(18);
        savePosition(target, bubbleLp.y);
    }

    private void savePosition(float x, float y) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putFloat("bx", x).putFloat("by", y).apply();
    }

    // ---------------------------------------------------------------- panel

    private void togglePanel() {
        if (expanded) collapse(); else expand();
    }

    private void expand() {
        if (expanded) return;
        try {
            wm.removeView(bubble);
        } catch (Exception ignored) {
        }
        expanded = true;

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xF50C0A09);
        bg.setCornerRadius(dp(18));
        bg.setStroke(dp(1), 0xFF92400E);
        box.setBackground(bg);

        // header
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setPadding(dp(16), dp(10), dp(10), dp(10));
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView title = new TextView(this);
        title.setText("RIZZ REPLY");
        title.setTextColor(0xFFFBBF24);
        title.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 15);
        title.setTypeface(Typeface.create("sans-serif-black", Typeface.BOLD));
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        header.addView(title, tp);

        TextView reload = headerBtn("\u21BB");      // ↻
        reload.setOnClickListener(v -> {
            if (webView != null) webView.reload();
            Toast.makeText(this, "Reloaded", Toast.LENGTH_SHORT).show();
        });
        header.addView(reload);

        TextView close = headerBtn("\u2715");       // ✕
        close.setOnClickListener(v -> collapse());
        header.addView(close);

        // webview
        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.loadUrl(WEB_URL);

        box.addView(header, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        box.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                screenW() - dp(16), Math.round(screenH() * 0.66f),
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.CENTER;
        lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;

        panel = box;
        wm.addView(panel, lp);
    }

    private TextView headerBtn(String glyph) {
        TextView b = new TextView(this);
        b.setText(glyph);
        b.setTextColor(0xFFFBBF24);
        b.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 18);
        b.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(14), dp(6), dp(14), dp(6));
        GradientDrawable g = new GradientDrawable();
        g.setColor(0xFF292524);
        g.setCornerRadius(dp(12));
        b.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = dp(8);
        b.setLayoutParams(lp);
        return b;
    }

    private void collapse() {
        if (!expanded) return;
        expanded = false;
        if (panel != null) {
            try {
                wm.removeView(panel);
            } catch (Exception ignored) {
            }
            panel = null;
        }
        if (webView != null) {
            try {
                webView.destroy();
            } catch (Exception ignored) {
            }
            webView = null;
        }
        if (bubble != null && bubble.getParent() == null) {
            try {
                wm.addView(bubble, bubbleLp);
            } catch (Exception ignored) {
            }
        }
    }

    // ---------------------------------------------------------------- size / misc

    /** Live-resize the bubble when the user changes the size setting. */
    public void resizeNow() {
        int newPx = dp(sizeDp());
        if (expanded || bubble == null || newPx == bubbleSizePx) return;
        bubbleSizePx = newPx;
        bubble.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, Math.max(16, sizeDp() / 3));
        bubbleLp.width = bubbleLp.height = newPx;
        try {
            wm.updateViewLayout(bubble, bubbleLp);
        } catch (Exception ignored) {
        }
    }

    public static void applySize(Context c) {
        FloatService svc = instance;
        if (svc != null && running) svc.resizeNow();
    }

    private void vibrate(int ms) {
        try {
            Vibrator v;
            if (Build.VERSION.SDK_INT >= 31) {
                VibratorManager vm = getSystemService(VibratorManager.class);
                v = vm.getDefaultVibrator();
            } else {
                v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            }
            if (v != null) {
                v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            }
        } catch (Exception ignored) {
        }
    }

    private int screenW() {
        return getResources().getDisplayMetrics().widthPixels;
    }

    private int screenH() {
        return getResources().getDisplayMetrics().heightPixels;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    // ---------------------------------------------------------------- notification

    private void createChannel() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Floating bubble",
                    NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps the RizzFloat bubble alive");
            nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        PendingIntent openPi = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Intent stopI = new Intent(this, FloatService.class);
        stopI.setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stopI,
                PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.notif_icon)
                .setContentTitle("RizzFloat is ON")
                .setContentText("Bubble is floating — STOP here or long-press the bubble")
                .setContentIntent(openPi)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(
                        android.R.drawable.ic_menu_close_clear_cancel, "STOP", stopPi).build())
                .build();
    }

    @Override
    public void onDestroy() {
        running = false;
        instance = null;
        if (bubble != null) {
            savePosition(bubbleLp.x, bubbleLp.y);
            try {
                wm.removeView(bubble);
            } catch (Exception ignored) {
            }
            bubble = null;
        }
        expanded = false;
        if (panel != null) {
            try {
                wm.removeView(panel);
            } catch (Exception ignored) {
            }
            panel = null;
        }
        if (webView != null) {
            try {
                webView.destroy();
            } catch (Exception ignored) {
            }
            webView = null;
        }
        stopForeground(true);
        super.onDestroy();
    }
}
