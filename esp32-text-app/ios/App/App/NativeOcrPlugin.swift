import Foundation
import Capacitor
import Vision
import UIKit

@objc(NativeOcrPlugin)
public class NativeOcrPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeOcrPlugin"
    public let jsName = "NativeOcr"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognizeText", returnType: CAPPluginReturnPromise)
    ]

    @objc func recognizeText(_ call: CAPPluginCall) {
        guard var base64String = call.getString("base64") else {
            call.reject("Image data (base64) is required")
            return
        }

        if let commaIndex = base64String.firstIndex(of: ",") {
            base64String = String(base64String[base64String.index(after: commaIndex)...])
        }

        guard let data = Data(base64Encoded: base64String),
              let uiImage = UIImage(data: data),
              let cgImage = uiImage.cgImage else {
            call.reject("Failed to decode image data into UIImage")
            return
        }

        let requestHandler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        let request = VNRecognizeTextRequest { (request, error) in
            if let error = error {
                call.reject("Apple Vision OCR failed: \(error.localizedDescription)")
                return
            }

            guard let observations = request.results as? [VNRecognizedTextObservation] else {
                call.resolve(["text": "", "confidence": 0, "lines": []])
                return
            }

            var recognizedLines: [String] = []
            var totalConfidence: Float = 0.0
            var count = 0

            for observation in observations {
                if let candidate = observation.topCandidates(1).first {
                    recognizedLines.append(candidate.string)
                    totalConfidence += candidate.confidence
                    count += 1
                }
            }

            let fullText = recognizedLines.joined(separator: "\n")
            let avgConf = count > 0 ? Int((totalConfidence / Float(count)) * 100) : (fullText.isEmpty ? 0 : 90)

            call.resolve([
                "text": fullText,
                "confidence": avgConf,
                "lines": recognizedLines,
                "blocksCount": observations.count
            ])
        }

        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try requestHandler.perform([request])
            } catch {
                call.reject("Vision request error: \(error.localizedDescription)")
            }
        }
    }
}
