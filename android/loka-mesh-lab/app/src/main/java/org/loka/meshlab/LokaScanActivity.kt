package org.loka.meshlab

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.journeyapps.barcodescanner.CaptureActivity
import com.journeyapps.barcodescanner.DecoratedBarcodeView

/** In-app scanner; CaptureActivity owns camera permission, pause/resume and result handling. */
class LokaScanActivity : CaptureActivity() {
    override fun initializeContent(): DecoratedBarcodeView {
        fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(16, 23, 19))
            setPadding(dp(24), dp(20), dp(24), dp(24))
            setOnApplyWindowInsetsListener { view, insets ->
                view.setPadding(dp(24) + insets.systemWindowInsetLeft, dp(20) + insets.systemWindowInsetTop,
                    dp(24) + insets.systemWindowInsetRight, dp(24) + insets.systemWindowInsetBottom)
                insets.consumeSystemWindowInsets()
            }
        }
        val back = TextView(this).apply {
            text = "‹"; textSize = 36f; setTextColor(Color.WHITE)
            gravity = Gravity.CENTER; contentDescription = "Go back"
            isClickable = true; isFocusable = true
            setOnClickListener { setResult(RESULT_CANCELED); finish() }
        }
        root.addView(back, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(TextView(this).apply {
            text = "Scan a LOKA code"; textSize = 28f; setTextColor(Color.WHITE)
            setPadding(0, dp(24), 0, dp(12))
        })
        root.addView(TextView(this).apply {
            text = "Place your friend’s code inside the frame."; textSize = 16f; setTextColor(Color.LTGRAY)
        })
        val area = FrameLayout(this)
        root.addView(area, LinearLayout.LayoutParams(-1, 0, 1f))
        val size = minOf(resources.displayMetrics.widthPixels - dp(48), dp(320), (resources.displayMetrics.heightPixels * .48f).toInt())
        val scanner = DecoratedBarcodeView(this).apply {
            background = GradientDrawable().apply { setColor(Color.BLACK); cornerRadius = dp(24).toFloat() }
            clipToOutline = true
        }
        area.addView(scanner, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
        // ZXing's viewfinder provides the animated scan line; the outline remains visible without motion.
        area.addView(android.view.View(this).apply {
            importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO
            background = GradientDrawable().apply { setColor(Color.TRANSPARENT); cornerRadius = dp(24).toFloat(); setStroke(dp(3), Color.rgb(130, 220, 183)) }
        }, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
        root.addView(TextView(this).apply {
            text = "Your camera stays on this phone. Review the contact before adding them."
            textSize = 14f; setTextColor(Color.LTGRAY); gravity = Gravity.CENTER
        })
        setContentView(root)
        return scanner
    }
}
