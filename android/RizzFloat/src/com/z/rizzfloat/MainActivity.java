package com.z.rizzfloat;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * RizzFloat control panel — turn the floating bubble ON / OFF,
 * check overlay permission, pick bubble size, open the RizzReply web app.
 */
public class MainActivity extends Activity {

    private static final int[] SIZE_DP = {52, 66, 80};
    private static final String[] SIZE_LABEL = {"SMALL", "MEDIUM", "LARGE"};
    private static final int AMBER = 0xFFF59E0B;
    private static final int AMBER_LIGHT = 0xFFFBBF24;
    private static final int DARK = 0xFF1C1917;
    private static final int CARD = 0xFF1C1917;
    private static final int TEXT = 0xFFE7E5E4;
    private static final int MUTED = 0xFFA8A29E;

    private int sizeIndex;
    private Button[] sizeBtns;
    private LinearLayout statusDot;
    private TextView statusTitle, statusSub, permRow;
    private Button mainBtn;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        buildUi();
    }

    private void buildUi() {
        sizeIndex = getSharedPreferences(FloatService.PREFS, MODE_PRIVATE)
                .getInt("sizeIdx", 1);
        boolean running = FloatService.running;
        boolean overlayOk = Settings.canDrawOverlays(this);

        getWindow().setStatusBarColor(0xFF0C0A09);
        getWindow().setNavigationBarColor(0xFF0C0A09);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFF0C0A09);
        scroll.setFillViewport(true);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(20), dp(28), dp(20), dp(24));
        scroll.addView(col, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);

        // ---- header
        TextView title = new TextView(this);
        title.setText("\uD83E\uDEE7 RizzFloat");
        title.setTextColor(AMBER_LIGHT);
        title.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 30);
        title.setTypeface(Typeface.create("sans-serif-black", Typeface.BOLD));
        col.addView(title);

        TextView sub = new TextView(this);
        sub.setText("Floating RizzReply bubble — rizz over any app");
        sub.setTextColor(MUTED);
        sub.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 13);
        col.addView(sub);
        col.addView(space(18));

        // ---- status card
        LinearLayout card = card();
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        statusDot = new LinearLayout(this);
        GradientDrawable dot = new GradientDrawable();
        dot.setShape(GradientDrawable.OVAL);
        dot.setColor(running ? 0xFF22C55E : 0xFF57534E);
        statusDot.setBackground(dot);
        row.addView(statusDot, new LinearLayout.LayoutParams(dp(12), dp(12)));

        statusTitle = new TextView(this);
        statusTitle.setTextColor(TEXT);
        statusTitle.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 17);
        statusTitle.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        statusTitle.setText(running ? "  Bubble is ON" : "  Bubble is OFF");
        row.addView(statusTitle);
        card.addView(row);

        statusSub = new TextView(this);
        statusSub.setTextColor(MUTED);
        statusSub.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 13);
        statusSub.setText(running
                ? "Floating over your apps — tap the R bubble to open RizzReply"
                : "Turn it on below, then open X — the bubble floats on top");
        statusSub.setPadding(0, dp(6), 0, 0);
        card.addView(statusSub);

        permRow = new TextView(this);
        permRow.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 13);
        permRow.setPadding(0, dp(8), 0, 0);
        permRow.setText(overlayOk
                ? "\u2713 Overlay permission granted"
                : "\u2717 Overlay permission required");
        permRow.setTextColor(overlayOk ? 0xFF4ADE80 : 0xFFF87171);
        card.addView(permRow);
        col.addView(card);
        col.addView(space(16));

        // ---- main toggle
        mainBtn = bigBtn(running ? "STOP FLOATING BUBBLE" : "START FLOATING BUBBLE");
        if (running) {
            styleBtn(mainBtn, 0xFF7F1D1D, 0xFFFECACA, false);
        } else {
            styleBtn(mainBtn, AMBER, DARK, false);
        }
        mainBtn.setOnClickListener(v -> toggle(running));
        col.addView(mainBtn, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));
        col.addView(space(12));

        // ---- overlay permission button (only when missing)
        if (!overlayOk) {
            Button permBtn = bigBtn("GRANT 'DISPLAY OVER APPS' PERMISSION");
            styleBtn(permBtn, 0xFF292524, AMBER_LIGHT, true);
            permBtn.setOnClickListener(v -> {
                try {
                    Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + getPackageName()));
                    startActivity(i);
                } catch (Exception e) {
                    startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION));
                }
            });
            col.addView(permBtn, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));
            col.addView(space(12));
        }

        // ---- bubble size card
        LinearLayout sizeCard = card();
        TextView sizeLbl = new TextView(this);
        sizeLbl.setText("BUBBLE SIZE");
        sizeLbl.setTextColor(MUTED);
        sizeLbl.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 12);
        sizeLbl.setLetterSpacing(0.08f);
        sizeLbl.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        sizeCard.addView(sizeLbl);
        sizeCard.addView(space(10));

        LinearLayout seg = new LinearLayout(this);
        seg.setOrientation(LinearLayout.HORIZONTAL);
        sizeBtns = new Button[SIZE_DP.length];
        for (int i = 0; i < SIZE_DP.length; i++) {
            final int idx = i;
            Button sb = new Button(this);
            sb.setText(SIZE_LABEL[i]);
            sb.setAllCaps(false);
            sb.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 13);
            sb.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
            sb.setStateListAnimator(null);
            if (i == sizeIndex) {
                styleBtn(sb, AMBER, DARK, false);
            } else {
                styleBtn(sb, 0xFF292524, MUTED, false);
            }
            sb.setOnClickListener(v -> setSize(idx));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    0, dp(42), 1f);
            if (i > 0) lp.leftMargin = dp(8);
            seg.addView(sb, lp);
            sizeBtns[i] = sb;
        }
        sizeCard.addView(seg);
        col.addView(sizeCard);
        col.addView(space(16));

        // ---- open web app card
        LinearLayout webCard = card();
        TextView webLbl = new TextView(this);
        webLbl.setText("RIZZREPLY WEB APP");
        webLbl.setTextColor(MUTED);
        webLbl.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 12);
        webLbl.setLetterSpacing(0.08f);
        webLbl.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        webCard.addView(webLbl);
        TextView url = new TextView(this);
        String shortUrl = FloatService.WEB_URL.replaceFirst("https://", "");
        url.setText(shortUrl);
        url.setTextColor(AMBER_LIGHT);
        url.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 12);
        url.setPadding(0, dp(6), 0, dp(10));
        webCard.addView(url);
        Button openBtn = bigBtn("OPEN IN BROWSER");
        styleBtn(openBtn, 0xFF292524, AMBER_LIGHT, true);
        openBtn.setOnClickListener(v -> startActivity(
                new Intent(Intent.ACTION_VIEW, Uri.parse(FloatService.WEB_URL))));
        webCard.addView(openBtn, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(44)));
        col.addView(webCard);
        col.addView(space(16));

        // ---- help card
        LinearLayout help = card();
        TextView helpLbl = new TextView(this);
        helpLbl.setText("HOW IT WORKS");
        helpLbl.setTextColor(MUTED);
        helpLbl.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 12);
        helpLbl.setLetterSpacing(0.08f);
        helpLbl.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        help.addView(helpLbl);
        help.addView(space(8));
        String[] steps = {
                "1.  Tap START — allow 'Display over other apps' if asked",
                "2.  Open X (or any app) — the amber R bubble floats on top",
                "3.  Tap the bubble — RizzReply panel slides in",
                "4.  Paste a tweet, pick a tone, copy the reply",
                "5.  Drag the bubble anywhere — it snaps to the edge"
        };
        for (String s : steps) {
            TextView t = new TextView(this);
            t.setText(s);
            t.setTextColor(TEXT);
            t.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 13);
            t.setPadding(0, dp(4), 0, dp(4));
            help.addView(t);
        }
        help.addView(space(4));
        TextView tip = new TextView(this);
        tip.setText("Tip: long-press the bubble to kill it instantly, \u21BB reloads the panel");
        tip.setTextColor(MUTED);
        tip.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 12);
        tip.setPadding(0, dp(2), 0, 0);
        help.addView(tip);
        col.addView(help);
        col.addView(space(20));

        TextView footer = new TextView(this);
        footer.setText("RizzFloat v1.0  \u2022  RizzReply extension v0.6.0  \u2022  made with z");
        footer.setTextColor(0xFF57534E);
        footer.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 11);
        footer.setGravity(Gravity.CENTER);
        col.addView(footer);
    }

    private void toggle(boolean wasRunning) {
        boolean overlayOk = Settings.canDrawOverlays(this);
        if (!overlayOk) {
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName())));
            } catch (Exception e) {
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION));
            }
            Toast.makeText(this, "Allow 'Display over other apps', then come back",
                    Toast.LENGTH_LONG).show();
            return;
        }
        if (wasRunning) {
            stopService(new Intent(this, FloatService.class));
            Toast.makeText(this, "Bubble OFF", Toast.LENGTH_SHORT).show();
        } else {
            Intent i = new Intent(this, FloatService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                startForegroundService(i);
            } else {
                startService(i);
            }
            Toast.makeText(this, "Bubble ON — floating!", Toast.LENGTH_SHORT).show();
        }
        mainBtn.postDelayed(this::buildUi, 400);
    }

    private void setSize(int idx) {
        sizeIndex = idx;
        getSharedPreferences(FloatService.PREFS, MODE_PRIVATE).edit()
                .putInt("sizeIdx", idx).apply();
        FloatService.applySize(this);
        for (int i = 0; i < sizeBtns.length; i++) {
            if (i == idx) {
                styleBtn(sizeBtns[i], AMBER, DARK, false);
            } else {
                styleBtn(sizeBtns[i], 0xFF292524, MUTED, false);
            }
        }
        Toast.makeText(this, "Bubble size: " + SIZE_LABEL[idx], Toast.LENGTH_SHORT).show();
    }

    // ---------------------------------------------------------------- widgets

    private LinearLayout card() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable g = new GradientDrawable();
        g.setColor(CARD);
        g.setCornerRadius(dp(16));
        c.setBackground(g);
        c.setPadding(dp(16), dp(16), dp(16), dp(16));
        return c;
    }

    private Button bigBtn(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(true);
        b.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 14);
        b.setTypeface(Typeface.create("sans-serif-black", Typeface.BOLD));
        b.setStateListAnimator(null);
        b.setLetterSpacing(0.04f);
        return b;
    }

    private void styleBtn(Button b, int bg, int fg, boolean outline) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(bg);
        g.setCornerRadius(dp(14));
        if (outline) g.setStroke(dp(1), AMBER);
        b.setBackground(g);
        b.setTextColor(fg);
    }

    private View space(int h) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(1, dp(h)));
        return v;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
