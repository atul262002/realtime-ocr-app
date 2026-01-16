import json
import numpy as np
import time
import torch
from flask import Flask, request, jsonify
import os
import logging
import traceback
import base64
from PIL import Image
import io
import tensorrt as trt
import pycuda.driver as cuda
import pycuda.autoinit
from strhub.data.module import SceneTextDataModule
from strhub.data.utils import Tokenizer

from flask_sock import Sock
import struct
import json
import os
from datetime import datetime
from pathlib import Path
import cv2


# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

app = Flask(__name__)
sock = Sock(app)
# Constants
C = 3
H = 32
W = 128
INPUT = "input"
OUTPUT = "output"

class TRTExecutor:
    """TensorRT engine executor for a single model"""
    def __init__(self, engine_path, charset_path, language, batch_size=200):
        self.batch_size = batch_size
        self.language = language
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        a = torch.zeros(1, device=self.device)
        # Load charset and tokenizer
        with open(charset_path, "r", encoding="utf-8") as f:
            charset = json.load(f)
        self.tokenizer = Tokenizer(charset[language])

        # Load transform
        self.transform = SceneTextDataModule.get_transform([H, W])

        # Initialize TensorRT engine
        self.logger = trt.Logger(trt.Logger.WARNING)
        with open(engine_path, "rb") as f, trt.Runtime(self.logger) as runtime:
            engine = runtime.deserialize_cuda_engine(f.read())

        self.context = engine.create_execution_context()
        self.stream = cuda.Stream()
        
        # Store CUDA context for thread safety
        self.cuda_context = pycuda.autoinit.context

        # Allocate memory
        self.host_input = cuda.pagelocked_empty(
            int(np.prod(self.context.get_tensor_shape(INPUT))),
            dtype=np.float32
        )
        self.device_input = cuda.mem_alloc(self.host_input.nbytes)
        self.context.set_tensor_address(INPUT, int(self.device_input))

        self.host_output = cuda.pagelocked_empty(
            int(np.prod(self.context.get_tensor_shape(OUTPUT))),
            dtype=np.float32
        )
        self.device_output = cuda.mem_alloc(self.host_output.nbytes)
        self.context.set_tensor_address(OUTPUT, int(self.device_output))

        logging.info(f"TensorRT engine loaded for {language}")

    def execute_batch(self, images):
        """Execute inference on a batch of images"""
        # Transform images
        images = torch.stack([
            self.transform(image) if image.mode == "RGB"
            else self.transform(image).repeat(3, 1, 1)
            for image in images
        ]).to(self.device)

        # Pad if needed
        needs_padding = images.shape[0] < self.batch_size
        if needs_padding:
            pad = torch.zeros(
                self.batch_size - images.shape[0],
                *images.shape[1:],
                device=self.device
            )
            images = torch.cat([images, pad], dim=0)

        # Copy to device and execute
        # Copy to device and execute
        self.cuda_context.push()
        try:
            np.copyto(self.host_input, images.cpu().numpy().ravel())
            cuda.memcpy_htod_async(self.device_input, self.host_input, self.stream)
            self.context.execute_async_v3(stream_handle=self.stream.handle)
            cuda.memcpy_dtoh_async(self.host_output, self.device_output, self.stream)
            self.stream.synchronize()
        finally:
            self.cuda_context.pop()

        # Get predictions
        pred = torch.tensor(
            self.host_output.reshape(self.context.get_tensor_shape(OUTPUT))
        ).to(self.device)

        # Remove padding
        if needs_padding:
            pred = pred[:images.shape[0] - pad.shape[0]]

        pred = pred.softmax(-1)

        # Decode predictions
        labels, _ = self.tokenizer.decode(pred)

        # Calculate confidences
        token_ids = pred.argmax(-1)
        all_confs = []
        for i in range(pred.size(0)):
            confs = pred[i].gather(1, token_ids[i].unsqueeze(-1)).squeeze(-1).tolist()
            all_confs.append(confs)

        avg_confidences = [
            round(sum(conf_list) / len(conf_list), 4) if conf_list else 0.0
            for conf_list in all_confs
        ]

        return list(zip(labels, avg_confidences))

    def cleanup(self):
        """Free GPU memory"""
        try:
            self.device_input.free()
            self.device_output.free()
            del self.context
            del self.stream
            logging.info(f"Cleaned up TensorRT resources for {self.language}")
        except Exception as e:
            logging.error(f"Error during cleanup: {str(e)}")


class TRTModelManager:
    """Manager for loading/unloading TRT engines on demand"""
    def __init__(self):
        self.current_executor = None
        self.current_model = None
        self.batch_size = 200

        # Model name to TRT engine path mapping
        self.model_engines = {
            'assamese_iitd': "checkpoints/trt/Assamese.trt",
            "english_iitd": "checkpoints/trt/English.trt",
            "bengali_iitd": "checkpoints/trt/Bengali.trt",
            "hindi_iitd": "checkpoints/trt/Hindi.trt",
            "bhili_iitd": "checkpoints/trt/Hindi.trt",
            "gondi_iitd": "checkpoints/trt/Hindi.trt",
            "mundari_iitd": "checkpoints/trt/Hindi.trt",
            "konkani_iitd": "checkpoints/trt/Hindi.trt",
            "kashmiri_iitd": "checkpoints/trt/Hindi.trt",
            "maithili_iitd": "checkpoints/trt/Hindi.trt",
            "nepali_iitd": "checkpoints/trt/Hindi.trt",
            "dogri_iitd": "checkpoints/trt/Hindi.trt",
            "bodo_iitd": "checkpoints/trt/Hindi.trt",
            "tamil_iitd": "checkpoints/trt/Tamil.trt",
            "telugu_iitd": "checkpoints/trt/Telugu.trt",
            "punjabi_iitd": "checkpoints/trt/Punjabi.trt",
            "urdu_iitd": "checkpoints/trt/Urdu.trt",
            "gujrati_iitd": "checkpoints/trt/Gujarati.trt",
            "kannada_iitd": "checkpoints/trt/Kannada.trt",
            "oriya_iitd": "checkpoints/trt/Oriya.trt",
            "sanskrit_iitd": "checkpoints/trt/Hindi.trt",
            "malayalam_iitd": "checkpoints/trt/Malayalam.trt",
            "manipuri_iitd": "checkpoints/trt/Manipuri.trt",
            "marathi_iitd": "checkpoints/trt/Marathi.trt",
            "triplet_hi_en_gu":"checkpoints/trt/Hindi_English_Gujarati.trt",
            "triplet_hi_en_mni":"checkpoints/trt/Hindi_English_Manipuri.trt",
            "triplet_hi_en_pa":"checkpoints/trt/Hindi_English_Punjabi.trt",
            "triplet_hi_en_ta":"checkpoints/trt/Hindi_English_Tamil.trt",
            "triplet_hi_en_te":"checkpoints/trt/Hindi_English_Telugu.trt"
        }

        # Model name to language mapping for charset
        self.model_to_language = {
            'assamese_iitd': "Assamese",
            "english_iitd": "English",
            "bengali_iitd": "Bengali",
            "hindi_iitd": "Hindi",
            "bhili_iitd": "Hindi",
            "gondi_iitd": "Hindi",
            "mundari_iitd": "Hindi",
            "konkani_iitd": "Hindi",
            "kashmiri_iitd": "Hindi",
            "maithili_iitd": "Hindi",
            "nepali_iitd": "Hindi",
            "dogri_iitd": "Hindi",
            "bodo_iitd": "Hindi",
            "tamil_iitd": "Tamil",
            "telugu_iitd": "Telugu",
            "punjabi_iitd": "Punjabi",
            "urdu_iitd": "Urdu",
            "gujrati_iitd": "Gujarati",
            "kannada_iitd": "Kannada",
            "oriya_iitd": "Oriya",
            "sanskrit_iitd": "Hindi",
            "malayalam_iitd": "Malayalam",
            "manipuri_iitd": "Manipuri",
            "marathi_iitd": "Marathi",
            "triplet_hi_en_gu":"Hindi_English_Gujarati",
            "triplet_hi_en_mni":"Hindi_English_Manipuri",
            "triplet_hi_en_pa":"Hindi_English_Punjabi",
            "triplet_hi_en_ta":"Hindi_English_Tamil",
            "triplet_hi_en_te":"Hindi_English_Telugu"
        }

        self.charset_path = "charset.json"

    def get_engine_path(self, model_name):
        """Get TRT engine path for given model name"""
        engine_file = self.model_engines.get(model_name)
        if not engine_file:
            raise ValueError(
                f"Unknown model name: {model_name}. "
                f"Available models: {list(self.model_engines.keys())}"
            )

        if not os.path.exists(engine_file):
            raise FileNotFoundError(f"TRT engine file not found: {engine_file}")

        return engine_file

    def load_model(self, model_name):
        """Load TRT engine, unloading previous if necessary"""
        # If same model is already loaded, return
        if self.current_model == model_name and self.current_executor:
            logging.info(f"Model {model_name} already loaded, reusing")
            return self.current_executor

        # Unload current model if exists
        if self.current_executor:
            logging.info(f"Unloading current model: {self.current_model}")
            self.current_executor.cleanup()
            self.current_executor = None
            self.current_model = None
            torch.cuda.empty_cache()

        # Load new model
        try:
            logging.info(f"Loading TRT engiextendne for model: {model_name}")
            engine_path = self.get_engine_path(model_name)
            language = self.model_to_language[model_name]

            self.current_executor = TRTExecutor(
                engine_path,
                self.charset_path,
                language,
                self.batch_size
            )
            self.current_model = model_name

            logging.info(f"Model {model_name} loaded successfully")
            return self.current_executor

        except Exception as e:
            logging.error(f"Error loading model {model_name}: {str(e)}")
            logging.error(traceback.format_exc())
            raise

    def base64_to_pil_image(self, base64_str):
        """Convert base64 string to PIL Image"""
        try:
            if base64_str.startswith('data:'):
                base64_str = base64_str.split(',')[1]

            image_data = base64.b64decode(base64_str)
            image = Image.open(io.BytesIO(image_data))

            if image.mode != 'RGB':
                image = image.convert('RGB')

            return image
        except Exception as e:
            logging.error(f"Error converting base64 to PIL image: {str(e)}")
            raise

    def infer_multiple_images(self, images, model_name):
        """Process multiple images in batches"""
        try:
            logging.info(f"Starting inference for {len(images)} images with model: {model_name}")

            # Load the model
            executor = self.load_model(model_name)

            recognized_texts = []

            for i in range(0, len(images), self.batch_size):
                batch_start = i
                batch_end = min(i + self.batch_size, len(images))
                logging.info(f"Processing batch {i//self.batch_size + 1}, images {batch_start} to {batch_end}")

                batch_images = images[batch_start:batch_end]
                batch_results = executor.execute_batch(batch_images)
                print(batch_results)
                recognized_texts.extend(batch_results)

                logging.info(f"Batch {i//self.batch_size + 1} complete. Total results: {len(recognized_texts)}")

            logging.info(f"All batches processed. Total results: {len(recognized_texts)}")
            return recognized_texts

        except Exception as e:
            logging.error(f"Error in infer_multiple_images: {str(e)}")
            logging.error(traceback.format_exc())
            raise


# Initialize model manager
model_manager = TRTModelManager()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'cuda_available': torch.cuda.is_available(),
        'current_loaded_model': model_manager.current_model,
        'available_models': list(model_manager.model_engines.keys())
    })

@app.route('/models', methods=['GET'])
def list_models():
    """List available models"""
    return jsonify({
        'available_models': list(model_manager.model_engines.keys()),
        'current_loaded_model': model_manager.current_model
    })

@app.route('/recognize', methods=['POST'])
def recognize_text():
    """Main OCR endpoint"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400

        model_name = data.get('model_name')
        base64_images = data.get('images', [])

        if not model_name:
            return jsonify({'error': 'model_name is required'}), 400

        if not base64_images:
            return jsonify({'error': 'images list is required'}), 400

        logging.info(f"Processing {len(base64_images)} images with model: {model_name}")

        # Convert base64 images to PIL images
        try:
            # model_name="hindi_iitd"
            images = [model_manager.base64_to_pil_image(img_b64) for img_b64 in base64_images]
        except Exception as e:
            return jsonify({'error': f'Failed to process images: {str(e)}'}), 400

        # Run inference (model will be loaded/switched automatically)
        try:
            start_time = time.time()
            results = model_manager.infer_multiple_images(images, model_name)
            inference_time = time.time() - start_time

            logging.info(f"Recognition completed successfully for {len(results)} images in {inference_time:.2f}s")

            return jsonify({
                'recognized_texts': results,
                'model_used': model_name,
                'num_images': len(images),
                'inference_time': round(inference_time, 3),
                'success': True
            })

        except Exception as e:
            logging.error(f"Inference failed: {str(e)}")
            return jsonify({'error': f'Inference failed: {str(e)}'}), 500

    except Exception as e:
        logging.error(f"Request processing failed: {str(e)}")
        logging.error(traceback.format_exc())
        return jsonify({'error': f'Request processing failed: {str(e)}'}), 500

@app.route('/recognize_batch', methods=['POST'])
def recognize_batch():
    """Batch OCR endpoint for multiple models"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400

        requests_data = data.get('requests', [])

        if not requests_data:
            return jsonify({'error': 'requests list is required'}), 400

        results = []

        for req_idx, req_data in enumerate(requests_data):
            # model_name = req_data.get('model_name')
            model_name='hindi_iitd'
            base64_images = req_data.get('images', [])

            try:
                # Convert images
                images = [model_manager.base64_to_pil_image(img_b64) for img_b64 in base64_images]

                # Run inference (model will be loaded/switched automatically)
                start_time = time.time()
                recognized_texts = model_manager.infer_multiple_images(images, model_name)
                inference_time = time.time() - start_time

                results.append({
                    'request_id': req_idx,
                    'model_name': model_name,
                    'recognized_texts': recognized_texts,
                    'inference_time': round(inference_time, 3),
                    'success': True,
                    'error': None
                })

            except Exception as e:
                logging.error(f"Error processing request {req_idx}: {str(e)}")
                results.append({
                    'request_id': req_idx,
                    'model_name': model_name,
                    'recognized_texts': [],
                    'success': False,
                    'error': str(e)
                })

        return jsonify({
            'results': results,
            'total_requests': len(requests_data),
            'success': True
        })

    except Exception as e:
        logging.error(f"Batch processing failed: {str(e)}")
        return jsonify({'error': f'Batch processing failed: {str(e)}'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500
model_manager


frame_count = 0
region_counts = {}

# Add OCR processing function
def perform_ocr_on_region(image_data, metadata, region_idx):
    """
    Perform OCR on the annotated region and return text
    """
    try:
        # Convert bytes to numpy arratrty
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            return "OCR_FAILED"

        model_name="english_iitd"
        img = [Image.fromarray(i) for i in img]
        text=model_manager.infer_multiple_images(img,model_name)
        # For now, return random text - replace with actual OCR (Tesseract, etc.)
        # You can install: pip install pytesseract
        # import pytesseract
        # text = pytesseract.image_to_string(img)

        # Mock OCR - replace this with real OCR
        # import random
        # mock_texts = ["Sample Text 123", "Hello World", "OCR Result", "Detected Text", "Random Content"]
        # text = f"REGION_{region_idx}: {random.choice(mock_texts)}"
        # import pytesseract

        # # If running on Linux, Tesseract must be installed:
        # # sudo apt install tesseract-ocr
        # # sudo apt install libtesseract-dev

        # text = pytesseract.image_to_string(img)
        # text = text.strip() if text else "NO_TEXT_DETECTED"
        # # -----------------------------------

        return text

        # return text

    except Exception as e:
        print(f"OCR error in region {region_idx}: {e}")
        return "OCR_ERROR"

# Modify the WebSocket handler to send back OCR results
@sock.route('/stream')
def stream(ws):
    global frame_count, region_counts
    print("Client connected to WebSocket")

    try:
        while True:
            data = ws.receive(timeout=5)
            if data is None:
                break

            if len(data) < 4:
                continue

            metadata_length = struct.unpack('>I', data[:4])[0]

            if len(data) < 4 + metadata_length:
                continue

            metadata_bytes = data[4:4 + metadata_length]
            metadata = json.loads(metadata_bytes.decode('utf-8'))
            image_data = data[4 + metadata_length:]

            region_idx = metadata['region_index']
            total_regions = metadata['total_regions']

            if region_idx not in region_counts:
                region_counts[region_idx] = 0
            region_counts[region_idx] += 1

            frame_count += 1

            # Perform OCR on this region
            ocr_text = perform_ocr_on_region(image_data, metadata, region_idx)

            # Send OCR result back to client
            response = {
                'region_index': region_idx,
                'ocr_text': ocr_text,
                'timestamp': metadata['timestamp'],
                'frame_count': region_counts[region_idx]
            }

            ws.send(json.dumps(response))

            print(f"Region {region_idx} - OCR: {ocr_text}")

    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        print(f"Client disconnected. Total frames: {frame_count}")
def process_annotated_region(image_data, metadata, region_idx):
    """
    Process each annotated region
    - image_data: JPEG bytes
    - metadata: dict with region info (index, position, size, timestamp)
    - region_idx: which annotated region this is
    """
    try:
        # Convert bytes to numpy array
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            print(f"Failed to decode image for region {region_idx}")
            return

        # Example processing: detect features, run object detection, etc.
        height, width = img.shape[:2]

        print(f"  Processing region {region_idx}: {width}x{height} pixels")

        # Add your custom processing here:
        # - Object detection on this specific region
        # - OCR if it's a text region
        # - Face detection if it's a face region
        # - Tracking specific objects
        # - Feature extraction
        # etc.

        # Example: Apply some processing (edge detection)
        # edges = cv2.Canny(img, 100, 200)
        # processed_path = FRAMES_DIR / f"region_{region_idx}" / f"processed_{metadata['timestamp']}.jpg"
        # cv2.imwrite(str(processed_path), edges)

    except Exception as e:
        print(f"Error processing region {region_idx}: {e}")



if __name__ == '__main__':
    logging.info("Starting TensorRT OCR Flask server on port 5050...")
    logging.info(f"Available models: {list(model_manager.model_engines.keys())}")
    logging.info(f"CUDA available: {torch.cuda.is_available()}")

    app.run(
        host='0.0.0.0',
        port=5050,
        debug=False,
        threaded=False
    )
