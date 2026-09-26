import cv2
import json
import os
import shutil
import numpy as np
import pytesseract
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Set TESSERACT_CMD when Tesseract is installed outside the standard locations.
tesseract_candidates = [
    os.environ.get('TESSERACT_CMD'),
    shutil.which('tesseract'),
    r'C:\Program Files\Tesseract-OCR\tesseract.exe',
    r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
    os.path.expandvars(r'%LOCALAPPDATA%\Tesseract-OCR\tesseract.exe'),
]
tesseract_cmd = next(
    (candidate for candidate in tesseract_candidates if candidate and os.path.isfile(candidate)),
    None,
)
if tesseract_cmd is None:
    raise RuntimeError(
        'Tesseract was not found. Install Tesseract OCR, then reopen the terminal. '
        'Alternatively set TESSERACT_CMD to the full path of tesseract.exe.'
    )
pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

def recognize(image):
    candidates = [image]
    grayscale = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    upscaled = cv2.resize(grayscale, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    enhanced = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(upscaled)
    candidates.append(enhanced)

    best_text = ''
    best_confidence = -1.0
    for candidate in candidates:
        data = pytesseract.image_to_data(
            candidate,
            config='--psm 6',
            output_type=pytesseract.Output.DICT,
        )
        words = []
        confidences = []
        for word, confidence in zip(data['text'], data['conf']):
            word = word.strip()
            if not word:
                continue
            words.append(word)
            try:
                confidence = float(confidence)
            except ValueError:
                continue
            if confidence >= 0:
                confidences.append(confidence)
        text = ' '.join(words).strip()
        average_confidence = (
            sum(confidences) / len(confidences) if confidences else 0.0
        )
        if text and average_confidence > best_confidence:
            best_text = text
            best_confidence = average_confidence
    return best_text, best_confidence


class OcrHandler(BaseHTTPRequestHandler):
    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def send_json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self.send_json(200, {'status': 'ok'})
            return
        self.send_json(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path != '/ocr':
            self.send_json(404, {'error': 'Not found'})
            return

        try:
            content_length = int(self.headers.get('Content-Length', '0'))
            if content_length <= 0 or content_length > 5 * 1024 * 1024:
                raise ValueError('Invalid image size')
            image_data = self.rfile.read(content_length)
            image = cv2.imdecode(np.frombuffer(image_data, dtype=np.uint8), cv2.IMREAD_COLOR)
            if image is None:
                raise ValueError('Invalid JPEG image')
            text, confidence = recognize(image)
            print(
                f'Image: {image.shape[1]}x{image.shape[0]}, '
                f'confidence: {confidence:.1f}, text: {text}'
            )
            self.send_json(200, {'text': text, 'confidence': round(confidence, 1)})
        except Exception as error:
            self.send_json(400, {'error': str(error)})

    def log_message(self, format, *args):
        return


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 5000), OcrHandler)
    print('OCR service running at http://127.0.0.1:5000/ocr')
    print('Open http://192.168.4.1/ and press Capture and read text.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nOCR service stopped.')
    finally:
        server.server_close()
