import os
import uuid
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room
from werkzeug.utils import secure_filename
import base64
import random

app = Flask(__name__)
CORS(app)

# Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///recordings.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max file size
app.config['SECRET_KEY'] = 'your-secret-key-here'

# Ensure upload folder exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*", max_http_buffer_size=10 * 1024 * 1024)

# Models (same as provided)
class Recording(db.Model):
    __tablename__ = 'recordings'
    id = db.Column(db.Integer, primary_key=True)
    uuid = db.Column(
        db.String(36),
        unique=True,
        nullable=False,
        default=lambda: str(uuid.uuid4())
    )
    title = db.Column(db.String(255), nullable=False, default='Untitled Recording')
    filename = db.Column(db.String(255), nullable=True)
    filepath = db.Column(db.String(500), nullable=True)
    duration = db.Column(db.Integer, default=0)
    file_size = db.Column(db.BigInteger, default=0)
    mime_type = db.Column(db.String(50), default='video/webm')
    thumbnail = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), default='recording')  # recording, completed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )
    regions = db.relationship(
        'Region',
        backref='recording',
        cascade='all, delete-orphan',
        order_by='Region.region_index'
    )

    def to_dict(self):
        return {
            'id': self.id,
            'uuid': self.uuid,
            'title': self.title,
            'filename': self.filename,
            'duration': self.duration,
            'file_size': self.file_size,
            'mime_type': self.mime_type,
            'thumbnail': self.thumbnail,
            'status': self.status,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'regions': [region.to_dict() for region in self.regions]
        }

class Region(db.Model):
    __tablename__ = 'regions'
    id = db.Column(db.Integer, primary_key=True)
    recording_id = db.Column(
        db.Integer,
        db.ForeignKey('recordings.id', ondelete='CASCADE'),
        nullable=False
    )
    region_index = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    words = db.relationship(
        'RegionWord',
        backref='region',
        cascade='all, delete-orphan',
        order_by='RegionWord.id'
    )
    __table_args__ = (
        db.UniqueConstraint(
            'recording_id',
            'region_index',
            name='uq_recording_region_index'
        ),
    )

    @property
    def name(self):
        return f"region{self.region_index}"

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'region_index': self.region_index,
            'words': [word.to_dict() for word in self.words]
        }

class RegionWord(db.Model):
    __tablename__ = 'region_words'
    id = db.Column(db.Integer, primary_key=True)
    region_id = db.Column(
        db.Integer,
        db.ForeignKey('regions.id', ondelete='CASCADE'),
        nullable=False
    )
    word = db.Column(db.String(100), nullable=False)
    start_time = db.Column(db.Float, nullable=True)
    end_time = db.Column(db.Float, nullable=True)
    confidence = db.Column(db.Float, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'word': self.word,
            'start_time': self.start_time,
            'end_time': self.end_time,
            'confidence': self.confidence
        }

# Initialize database
with app.app_context():
    db.create_all()

# ==================== REST APIs ====================

# API 1: Get all recordings with pagination
@app.route('/api/recordings', methods=['GET'])
def get_recordings():
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 10, type=int)
        search = request.args.get('search', '', type=str)
        status = request.args.get('status', None, type=str)
        
        query = Recording.query
        
        # Status filter
        if status:
            query = query.filter(Recording.status == status)
        
        # Search filter
        if search:
            query = query.filter(Recording.title.ilike(f'%{search}%'))
        
        # Pagination
        pagination = query.order_by(Recording.created_at.desc()).paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
        
        return jsonify({
            'success': True,
            'data': {
                'recordings': [rec.to_dict() for rec in pagination.items],
                'total': pagination.total,
                'page': pagination.page,
                'per_page': pagination.per_page,
                'total_pages': pagination.pages,
                'has_next': pagination.has_next,
                'has_prev': pagination.has_prev
            }
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# API 2A: Initialize/Create recording (before actual recording starts)
@app.route('/api/recordings/initialize', methods=['POST'])
def initialize_recording():
    """
    Create recording entry before streaming starts
    Frontend flow:
    1. User clicks "Start Recording"
    2. Popup opens asking for title and other details
    3. Call this API to create recording entry
    4. User defines regions on camera
    5. Call create_regions API
    6. Start streaming images
    """
    try:
        data = request.get_json()
        
        title = data.get('title', 'Untitled Recording')
        thumbnail = data.get('thumbnail', None)
        num_regions = data.get('num_regions', 0)
        
        # Create recording entry
        recording = Recording(
            title=title,
            thumbnail=thumbnail,
            status='recording'
        )
        
        db.session.add(recording)
        db.session.flush()  # Get the ID without committing
        
        # Create regions if specified
        regions = []
        if num_regions > 0:
            for i in range(num_regions):
                region = Region(
                    recording_id=recording.id,
                    region_index=i
                )
                db.session.add(region)
                regions.append(region)
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'data': {
                'recording_uuid': recording.uuid,
                'recording_id': recording.id,
                'title': recording.title,
                'status': recording.status,
                'regions': [r.to_dict() for r in regions]
            },
            'message': 'Recording initialized successfully'
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# API 2B: Upload video file when recording stops
@app.route('/api/recordings/<recording_uuid>/upload', methods=['POST'])
def upload_recording_video(recording_uuid):
    """
    Upload the video file after recording is complete
    Frontend flow:
    1. User clicks "Stop Recording"
    2. Video blob is available
    3. Call this API to upload the video
    """
    try:
        recording = Recording.query.filter_by(uuid=recording_uuid).first()
        
        if not recording:
            return jsonify({
                'success': False,
                'error': 'Recording not found'
            }), 404
        
        # Check if file is present
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No file provided'
            }), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({
                'success': False,
                'error': 'No file selected'
            }), 400
        
        # Get duration from form data
        duration = request.form.get('duration', 0, type=int)
        
        # Save file
        filename = secure_filename(file.filename) if file.filename else 'recording.webm'
        unique_filename = f"{recording.uuid}_{filename}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
        file.save(filepath)
        
        # Get file size
        file_size = os.path.getsize(filepath)
        
        # Update recording
        recording.filename = filename
        recording.filepath = filepath
        recording.duration = duration
        recording.file_size = file_size
        recording.mime_type = file.content_type or 'video/webm'
        recording.status = 'completed'
        recording.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'data': recording.to_dict(),
            'message': 'Video uploaded successfully'
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# API 3: Create/Update regions for a recording
@app.route('/api/recordings/<recording_uuid>/regions', methods=['POST'])
def create_regions(recording_uuid):
    """
    Create or update regions for a recording
    Can be called after initialize or separately
    """
    try:
        recording = Recording.query.filter_by(uuid=recording_uuid).first()
        
        if not recording:
            return jsonify({
                'success': False,
                'error': 'Recording not found'
            }), 404
        
        data = request.get_json()
        num_regions = data.get('num_regions', 1)
        
        if not isinstance(num_regions, int) or num_regions < 1:
            return jsonify({
                'success': False,
                'error': 'num_regions must be a positive integer'
            }), 400
        
        # Delete existing regions if any
        Region.query.filter_by(recording_id=recording.id).delete()
        
        # Create new regions
        created_regions = []
        for i in range(num_regions):
            region = Region(
                recording_id=recording.id,
                region_index=i
            )
            db.session.add(region)
            created_regions.append(region)
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'data': {
                'recording_uuid': recording.uuid,
                'regions': [r.to_dict() for r in created_regions]
            },
            'message': f'{num_regions} regions created successfully'
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get single recording with all regions
@app.route('/api/recordings/<recording_uuid>', methods=['GET'])
def get_recording(recording_uuid):
    try:
        recording = Recording.query.filter_by(uuid=recording_uuid).first()
        
        if not recording:
            return jsonify({
                'success': False,
                'error': 'Recording not found'
            }), 404
        
        return jsonify({
            'success': True,
            'data': recording.to_dict()
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Update recording details
@app.route('/api/recordings/<recording_uuid>', methods=['PATCH'])
def update_recording(recording_uuid):
    try:
        recording = Recording.query.filter_by(uuid=recording_uuid).first()
        
        if not recording:
            return jsonify({
                'success': False,
                'error': 'Recording not found'
            }), 404
        
        data = request.get_json()
        
        # Update allowed fields
        if 'title' in data:
            recording.title = data['title']
        if 'thumbnail' in data:
            recording.thumbnail = data['thumbnail']
        if 'duration' in data:
            recording.duration = data['duration']
        
        recording.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            'success': True,
            'data': recording.to_dict(),
            'message': 'Recording updated successfully'
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Delete recording
@app.route('/api/recordings/<recording_uuid>', methods=['DELETE'])
def delete_recording(recording_uuid):
    try:
        recording = Recording.query.filter_by(uuid=recording_uuid).first()
        
        if not recording:
            return jsonify({
                'success': False,
                'error': 'Recording not found'
            }), 404
        
        # Delete file if exists
        if recording.filepath and os.path.exists(recording.filepath):
            os.remove(recording.filepath)
        
        db.session.delete(recording)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Recording deleted successfully'
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ==================== WebSocket for Image Processing ====================

# Store active connections
active_sessions = {}

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')
    emit('connected', {'message': 'Connected to server', 'session_id': request.sid})

@socketio.on('disconnect')
def handle_disconnect():
    print(f'Client disconnected: {request.sid}')
    if request.sid in active_sessions:
        del active_sessions[request.sid]

@socketio.on('start_stream')
def handle_start_stream(data):
    """
    Initialize streaming session for all regions
    Expected data: {
        'recording_uuid': 'xxx-xxx-xxx'
    }
    
    Frontend flow:
    1. User has initialized recording
    2. User has created regions
    3. User clicks "Start Stream"
    4. This event is triggered
    5. Backend is ready to receive images for all regions
    """
    try:
        recording_uuid = data.get('recording_uuid')
        
        if not recording_uuid:
            emit('error', {'message': 'recording_uuid is required'})
            return
        
        recording = Recording.query.filter_by(uuid=recording_uuid).first()
        
        if not recording:
            emit('error', {'message': 'Recording not found'})
            return
        
        regions = Region.query.filter_by(recording_id=recording.id).all()
        
        if not regions:
            emit('error', {'message': 'No regions found. Please create regions first.'})
            return
        
        # Store session info
        active_sessions[request.sid] = {
            'recording_id': recording.id,
            'recording_uuid': recording.uuid,
            'regions': {r.region_index: r.id for r in regions},
            'region_count': len(regions)
        }
        
        # Join room for this recording
        join_room(f"recording_{recording.uuid}")
        
        emit('stream_started', {
            'recording_uuid': recording.uuid,
            'regions': [r.to_dict() for r in regions],
            'region_count': len(regions),
            'message': 'Stream started. Ready to receive images for all regions.'
        })
        
    except Exception as e:
        emit('error', {'message': str(e)})

@socketio.on('process_region_image')
def handle_process_region_image(data):
    """
    Process image from a specific region
    Expected data: {
        'region_index': 0,
        'image': 'base64_encoded_image',
        'timestamp': 1234.56
    }
    
    Frontend sends images from all regions continuously
    Backend processes each and returns transcribed text
    """
    try:
        if request.sid not in active_sessions:
            emit('error', {'message': 'Session not initialized. Call start_stream first'})
            return
        
        session = active_sessions[request.sid]
        region_index = data.get('region_index')
        image_data = data.get('image')
        timestamp = data.get('timestamp', 0.0)
        
        if region_index is None:
            emit('error', {'message': 'region_index is required'})
            return
        
        if not image_data:
            emit('error', {'message': 'No image data provided'})
            return
        
        if region_index not in session['regions']:
            emit('error', {'message': f'Invalid region_index: {region_index}'})
            return
        
        region_id = session['regions'][region_index]
        
        # Dummy OCR/Speech-to-text processing
        # Generate random words for simulation
        sample_words = ['The', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog', 'Time', 'Year', 'People', 'Way', 'Day', 'Man', 'Thing', 'Woman', 'Life', 'Child', 'World', 'School', 'State', 'Family', 'Student', 'Group', 'Country', 'Problem']
        
        # Pick 3-5 random words
        num_words = random.randint(3, 5)
        selected_words = [random.choice(sample_words) for _ in range(num_words)]
        
        dummy_words = []
        for word in selected_words:
            dummy_words.append({
                'word': word,
                'confidence': round(random.uniform(0.7, 0.99), 2),
                'duration': round(random.uniform(0.3, 0.8), 2)
            })
        
        
        # Save words to database
        saved_words = []
        current_time = timestamp
        
        for word_data in dummy_words:
            word = RegionWord(
                region_id=region_id,
                word=word_data['word'],
                start_time=current_time,
                end_time=current_time + word_data['duration'],
                confidence=word_data['confidence']
            )
            db.session.add(word)
            saved_words.append(word)
            current_time += word_data['duration']
        
        db.session.commit()
        
        # Prepare response
        response_data = {
            'region_index': region_index,
            'region_id': region_id,
            'timestamp': timestamp,
            'words': [w.to_dict() for w in saved_words],
            'text': ' '.join([w.word for w in saved_words])
        }
        
        # Send back to client
        emit('region_text_result', response_data)
        
    except Exception as e:
        db.session.rollback()
        emit('error', {'message': str(e), 'region_index': data.get('region_index')})

@socketio.on('stop_stream')
def handle_stop_stream():
    """
    Stop streaming session
    
    Frontend flow:
    1. User clicks "Stop Recording"
    2. This event is triggered
    3. Video blob becomes available
    4. Call upload API to save video
    """
    try:
        if request.sid in active_sessions:
            session = active_sessions[request.sid]
            recording_uuid = session['recording_uuid']
            
            # Get statistics
            recording = Recording.query.filter_by(uuid=recording_uuid).first()
            
            total_words = 0
            region_stats = []
            
            for region in recording.regions:
                word_count = len(region.words)
                total_words += word_count
                region_stats.append({
                    'region_index': region.region_index,
                    'word_count': word_count
                })
            
            emit('stream_stopped', {
                'recording_uuid': recording_uuid,
                'total_words': total_words,
                'regions': region_stats,
                'message': 'Stream stopped. You can now upload the video file.'
            })
            
            del active_sessions[request.sid]
        else:
            emit('error', {'message': 'No active session found'})
            
    except Exception as e:
        emit('error', {'message': str(e)})

# Serve uploaded files
@app.route('/uploads/<path:filename>')
def serve_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# Health check endpoint
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'success': True,
        'message': 'Server is running',
        'timestamp': datetime.utcnow().isoformat()
    }), 200

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)