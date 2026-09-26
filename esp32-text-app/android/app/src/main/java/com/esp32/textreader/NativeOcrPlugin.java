package com.esp32.textreader;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import androidx.annotation.NonNull;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.OnFailureListener;
import com.google.android.gms.tasks.OnSuccessListener;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "NativeOcr")
public class NativeOcrPlugin extends Plugin {

    private TextRecognizer recognizer;

    @Override
    public void load() {
        super.load();
        try {
            recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @PluginMethod
    public void recognizeText(PluginCall call) {
        String base64Data = call.getString("base64");
        if (base64Data == null || base64Data.trim().isEmpty()) {
            call.reject("Image data (base64) is required");
            return;
        }

        try {
            if (base64Data.contains(",")) {
                base64Data = base64Data.substring(base64Data.indexOf(",") + 1);
            }
            byte[] decodedBytes = Base64.decode(base64Data, Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.length);
            if (bitmap == null) {
                call.reject("Failed to decode image data into Bitmap");
                return;
            }

            int rotation = call.getInt("rotation", 0);
            if (rotation != 0 && rotation != 90 && rotation != 180 && rotation != 270) {
                rotation = 0;
            }

            InputImage inputImage = InputImage.fromBitmap(bitmap, rotation);

            if (recognizer == null) {
                recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            }

            recognizer.process(inputImage)
                .addOnSuccessListener(new OnSuccessListener<Text>() {
                    @Override
                    public void onSuccess(Text visionText) {
                        JSObject ret = new JSObject();
                        String fullText = visionText.getText();
                        ret.put("text", fullText != null ? fullText.trim() : "");

                        JSArray linesArr = new JSArray();
                        List<Float> confList = new ArrayList<>();

                        for (Text.TextBlock block : visionText.getTextBlocks()) {
                            for (Text.Line line : block.getLines()) {
                                linesArr.put(line.getText());
                                Float lineConf = line.getConfidence();
                                if (lineConf != null && lineConf > 0) {
                                    confList.add(lineConf);
                                }
                            }
                        }

                        int avgConf = 92;
                        if (!confList.isEmpty()) {
                            float sum = 0;
                            for (Float c : confList) sum += c;
                            avgConf = Math.round((sum / confList.size()) * 100);
                        } else if (fullText == null || fullText.trim().isEmpty()) {
                            avgConf = 0;
                        }

                        ret.put("confidence", avgConf);
                        ret.put("lines", linesArr);
                        ret.put("blocksCount", visionText.getTextBlocks().size());
                        call.resolve(ret);
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override
                    public void onFailure(@NonNull Exception e) {
                        call.reject("ML Kit recognition failed: " + e.getMessage(), e);
                    }
                });

        } catch (Exception e) {
            call.reject("Native OCR exception: " + e.getMessage(), e);
        }
    }
}
