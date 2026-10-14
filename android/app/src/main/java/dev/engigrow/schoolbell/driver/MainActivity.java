package dev.engigrow.schoolbell.driver;

import android.app.PictureInPictureParams;
import android.os.Build;
import android.util.Rational;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Enter PiP automatically when the driver presses Home while tracking.
    // The mini window keeps the map + status visible — exactly like Google Maps.
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            PictureInPictureParams params = new PictureInPictureParams.Builder()
                .setAspectRatio(new Rational(9, 16))
                .build();
            enterPictureInPictureMode(params);
        }
    }
}
