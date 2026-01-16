import React, { useState, useRef, useEffect } from 'react';
import { Square, ArrowLeft, X, Settings } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

const API_URL = 'http://localhost:5000';

function Recording() {
    const navigate = useNavigate();
    // State
    const [showNameModal, setShowNameModal] = useState(true);
    const [recordingName, setRecordingName] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [currentRecordingUuid, setCurrentRecordingUuid] = useState(null);
    const [regions, setRegions] = useState([]);
    const [regionTexts, setRegionTexts] = useState({});
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawStart, setDrawStart] = useState(null);
    const [tempRegion, setTempRegion] = useState(null);

    // Camera Selection State
    const [devices, setDevices] = useState([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState('');

    // Refs
    const videoRef = useRef(null); // Hidden source video
    const canvasRef = useRef(null); // Visible & Recorded Canvas
    const mediaRecorderRef = useRef(null);
    const recordedChunksRef = useRef([]);
    const streamIntervalRef = useRef(null);
    const requestRef = useRef(null); // RequestAnimationFrame
    const socketRef = useRef(null);

    // Refs for Render Loop
    const regionsRef = useRef(regions);
    const tempRegionRef = useRef(tempRegion);
    const regionTextsRef = useRef(regionTexts);

    // Keep refs in sync with state
    useEffect(() => { regionsRef.current = regions; }, [regions]);
    useEffect(() => { tempRegionRef.current = tempRegion; }, [tempRegion]);
    useEffect(() => { regionTextsRef.current = regionTexts; }, [regionTexts]);

    useEffect(() => {
        console.log('[DEBUG] Component mounted, initializing...');
        initializeSocket();
        getCameras();

        return () => {
            console.log('[DEBUG] Component unmounting, cleaning up...');
            stopEverything();
        };
    }, []);

    // Update camera when selection changes
    useEffect(() => {
        console.log('[DEBUG] Camera selection effect triggered', { showNameModal, selectedDeviceId });
        if (!showNameModal && selectedDeviceId) {
            console.log('[DEBUG] Starting camera with device:', selectedDeviceId);
            startCamera(selectedDeviceId);
        }
    }, [selectedDeviceId, showNameModal]);

    const getCameras = async () => {
        console.log('[DEBUG] Getting camera devices...');
        try {
            await navigator.mediaDevices.getUserMedia({ video: true }); // Request permission first
            const devices = await navigator.mediaDevices.enumerateDevices();
            console.log('[DEBUG] All devices:', devices);
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            console.log('[DEBUG] Video devices found:', videoDevices);
            setDevices(videoDevices);
            if (videoDevices.length > 0) {
                console.log('[DEBUG] Setting default device:', videoDevices[0].deviceId);
                setSelectedDeviceId(videoDevices[0].deviceId);
            } else {
                console.error('[DEBUG] No video devices found!');
            }
        } catch (err) {
            console.error("[DEBUG] Error enumerating devices:", err);
            alert("Camera permission denied or not available");
        }
    };

    // Main Render Loop
    useEffect(() => {
        console.log('[DEBUG] Setting up render loop...');
        if (requestRef.current) cancelAnimationFrame(requestRef.current);

        const render = () => {
            if (canvasRef.current && videoRef.current && videoRef.current.readyState >= 2) {
                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d');
                const video = videoRef.current;

                // DEBUG: Log once every 60 frames (about once per second at 60fps)
                if (!render.frameCount) render.frameCount = 0;
                render.frameCount++;
                if (render.frameCount % 60 === 0) {
                    console.log('[DEBUG] Render loop active - Video:', video.videoWidth, 'x', video.videoHeight,
                        'Canvas:', canvas.width, 'x', canvas.height,
                        'ReadyState:', video.readyState);
                }

                if (canvas.width !== video.videoWidth) {
                    console.log('[DEBUG] Setting canvas width:', video.videoWidth);
                    canvas.width = video.videoWidth;
                }
                if (canvas.height !== video.videoHeight) {
                    console.log('[DEBUG] Setting canvas height:', video.videoHeight);
                    canvas.height = video.videoHeight;
                }

                // 1. Draw Video
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // 2. Draw Regions
                regionsRef.current.forEach(region => {
                    ctx.strokeStyle = '#3b82f6';
                    ctx.lineWidth = 4;
                    ctx.strokeRect(region.x, region.y, region.width, region.height);

                    // Label
                    ctx.fillStyle = '#2563eb';
                    ctx.fillRect(region.x, region.y - 24, 80, 24);
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 14px Arial';
                    ctx.fillText(`Region ${region.index}`, region.x + 8, region.y - 7);

                    // Result Text Overlay
                    const result = regionTextsRef.current[region.index];
                    if (result && result.text) {
                        const text = result.text;
                        if (text) {
                            const maxW = 300;
                            const boxHeight = 30;
                            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                            ctx.fillRect(region.x, region.y + region.height, Math.min(region.width, maxW), boxHeight);

                            ctx.fillStyle = '#10b981'; // green-500
                            ctx.font = 'bold 16px monospace';
                            // Clip text
                            ctx.fillText(text.slice(-30), region.x + 5, region.y + region.height + 20);
                        }
                    }
                });

                // 3. Draw Temp
                if (tempRegionRef.current) {
                    const t = tempRegionRef.current;
                    ctx.strokeStyle = '#facc15';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([6, 6]);
                    ctx.strokeRect(t.x, t.y, t.width, t.height);
                    ctx.setLineDash([]);
                }
            } else {
                // DEBUG: Log when render conditions not met
                if (!render.notReadyLogged || render.frameCount % 60 === 0) {
                    console.log('[DEBUG] Render waiting - Canvas:', !!canvasRef.current,
                        'Video:', !!videoRef.current,
                        'ReadyState:', videoRef.current?.readyState);
                    render.notReadyLogged = true;
                }
            }
            requestRef.current = requestAnimationFrame(render);
        };
        requestRef.current = requestAnimationFrame(render);
        return () => {
            console.log('[DEBUG] Cleaning up render loop');
            cancelAnimationFrame(requestRef.current);
        };
    }, []);

    const stopEverything = () => {
        console.log('[DEBUG] Stopping everything...');
        if (socketRef.current) socketRef.current.close();
        if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
        if (videoRef.current && videoRef.current.srcObject) {
            videoRef.current.srcObject.getTracks().forEach(track => {
                console.log('[DEBUG] Stopping track:', track.label);
                track.stop();
            });
        }
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };

    const initializeSocket = () => {
        console.log('[DEBUG] Initializing socket...');
        import('https://cdn.socket.io/4.5.4/socket.io.min.js').then(() => {
            console.log('[DEBUG] Socket.io loaded, connecting to:', API_URL);
            socketRef.current = window.io(API_URL);
            socketRef.current.on('region_text_result', (data) => {
                console.log('[DEBUG] Received region text result:', data);
                setRegionTexts(prev => ({
                    ...prev,
                    [data.region_index]: {
                        text: data.text,
                        timestamp: data.timestamp,
                        words: data.words
                    }
                }));
            });
            socketRef.current.on('connect', () => {
                console.log('[DEBUG] Socket connected');
            });
            socketRef.current.on('disconnect', () => {
                console.log('[DEBUG] Socket disconnected');
            });
        });
    };

    const startCamera = async (deviceId) => {
        console.log('[DEBUG] startCamera called with deviceId:', deviceId);

        if (videoRef.current && videoRef.current.srcObject) {
            console.log('[DEBUG] Stopping existing video stream');
            videoRef.current.srcObject.getTracks().forEach(track => track.stop());
        }

        const constraints = {
            audio: true,
            video: deviceId ? { deviceId: { exact: deviceId } } : { width: 1280, height: 720 }
        };

        console.log('[DEBUG] Requesting media with constraints:', constraints);

        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('[DEBUG] Got media stream:', stream);
            console.log('[DEBUG] Stream tracks:', stream.getTracks().map(t => ({ kind: t.kind, label: t.label, enabled: t.enabled, readyState: t.readyState })));

            if (videoRef.current) {
                console.log('[DEBUG] Setting stream to video element');
                videoRef.current.srcObject = stream;

                videoRef.current.onloadedmetadata = () => {
                    console.log('[DEBUG] Video metadata loaded');
                    console.log('[DEBUG] Video dimensions:', videoRef.current.videoWidth, 'x', videoRef.current.videoHeight);
                    console.log('[DEBUG] Video readyState:', videoRef.current.readyState);

                    if (canvasRef.current) {
                        console.log('[DEBUG] Setting initial canvas size');
                        canvasRef.current.width = videoRef.current.videoWidth;
                        canvasRef.current.height = videoRef.current.videoHeight;

                        videoRef.current.play()
                            .then(() => {
                                console.log('[DEBUG] Video playing successfully');
                                console.log('[DEBUG] Final video state - dimensions:', videoRef.current.videoWidth, 'x', videoRef.current.videoHeight, 'paused:', videoRef.current.paused);
                            })
                            .catch(e => {
                                console.error("[DEBUG] Auto-play failed:", e);
                            });
                    }
                };

                // Additional event listeners for debugging
                videoRef.current.onplay = () => console.log('[DEBUG] Video onplay event');
                videoRef.current.onplaying = () => console.log('[DEBUG] Video onplaying event');
                videoRef.current.onerror = (e) => console.error('[DEBUG] Video error:', e);
                videoRef.current.onstalled = () => console.warn('[DEBUG] Video stalled');
                videoRef.current.onsuspend = () => console.warn('[DEBUG] Video suspended');

            } else {
                console.error('[DEBUG] videoRef.current is null!');
            }
        } catch (error) {
            console.error('[DEBUG] Error accessing camera:', error);
            console.error('[DEBUG] Error name:', error.name);
            console.error('[DEBUG] Error message:', error.message);

            // Fallback
            if (constraints.video.deviceId) {
                console.log("[DEBUG] Retrying with simple constraints (no specific device)...");
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    console.log('[DEBUG] Fallback stream obtained:', stream);
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                        videoRef.current.play().catch(e => console.error("[DEBUG] Fallback play failed:", e));
                    }
                } catch (e) {
                    console.error('[DEBUG] Fallback also failed:', e);
                    alert('Failed to access camera. Please check connections.');
                }
            } else {
                alert('Failed to access camera.');
            }
        }
    };

    const handleInitializeRecording = async () => {
        console.log('[DEBUG] Initialize recording with name:', recordingName);
        if (!recordingName.trim()) {
            console.warn('[DEBUG] Recording name is empty');
            return;
        }

        try {
            const response = await fetch(`${API_URL}/api/recordings/initialize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: recordingName, num_regions: 0 })
            });
            const data = await response.json();
            console.log('[DEBUG] Initialize response:', data);
            if (data.success) {
                setCurrentRecordingUuid(data.data.recording_uuid);
                setShowNameModal(false);
                console.log('[DEBUG] Recording initialized, UUID:', data.data.recording_uuid);
            }
        } catch (error) {
            console.error('[DEBUG] Initialize recording error:', error);
            alert('Failed to initialize recording');
        }
    };

    // --- Drawing Logic ---
    const getPos = (e) => {
        if (!canvasRef.current) return { x: 0, y: 0 };
        const rect = canvasRef.current.getBoundingClientRect();
        const scaleX = canvasRef.current.width / rect.width;
        const scaleY = canvasRef.current.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    const handleMouseDown = (e) => {
        if (isRecording) return;
        setIsDrawing(true);
        const pos = getPos(e);
        setDrawStart(pos);
        setTempRegion({ x: pos.x, y: pos.y, width: 0, height: 0 });
    };

    const handleMouseMove = (e) => {
        if (!isDrawing || !drawStart) return;
        const pos = getPos(e);
        setTempRegion({
            x: Math.min(pos.x, drawStart.x),
            y: Math.min(pos.y, drawStart.y),
            width: Math.abs(pos.x - drawStart.x),
            height: Math.abs(pos.y - drawStart.y)
        });
    };

    const handleMouseUp = () => {
        if (!isDrawing || !tempRegion) return;
        setIsDrawing(false);
        if (tempRegion.width > 20 && tempRegion.height > 20) {
            console.log('[DEBUG] Adding region:', tempRegion);
            setRegions([...regions, { ...tempRegion, index: regions.length }]);
        }
        setTempRegion(null);
        setDrawStart(null);
    };

    const removeRegion = (index) => {
        console.log('[DEBUG] Removing region:', index);
        setRegions(regions.filter(r => r.index !== index).map((r, i) => ({ ...r, index: i })));
    };


    // --- Streaming/Recording Logic ---

    const handleStartStream = async () => {
        console.log('[DEBUG] Starting stream with', regions.length, 'regions');
        if (regions.length === 0) {
            alert('Draw at least one region');
            return;
        }

        try {
            await fetch(`${API_URL}/api/recordings/${currentRecordingUuid}/regions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ num_regions: regions.length })
            });

            const stream = canvasRef.current.captureStream(30);
            console.log('[DEBUG] Canvas stream captured:', stream);

            // Try to add audio
            if (videoRef.current.srcObject) {
                const audioTracks = videoRef.current.srcObject.getAudioTracks();
                console.log('[DEBUG] Audio tracks available:', audioTracks.length);
                if (audioTracks.length > 0) {
                    stream.addTrack(audioTracks[0]);
                    console.log('[DEBUG] Added audio track');
                }
            }

            try {
                mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'video/webm' });
                console.log('[DEBUG] MediaRecorder created with video/webm');
            } catch (e) {
                console.log('[DEBUG] Fallback to default MediaRecorder');
                mediaRecorderRef.current = new MediaRecorder(stream);
            }

            mediaRecorderRef.current.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    console.log('[DEBUG] Recorded chunk:', e.data.size, 'bytes');
                    recordedChunksRef.current.push(e.data);
                }
            };
            mediaRecorderRef.current.start(1000);
            console.log('[DEBUG] MediaRecorder started');

            setIsRecording(true);

            socketRef.current.emit('start_stream', { recording_uuid: currentRecordingUuid });
            streamIntervalRef.current = setInterval(captureAndSendRegions, 1000);
            console.log('[DEBUG] Stream interval started');

        } catch (error) {
            console.error('[DEBUG] Start stream error:', error);
            alert('Failed to start recording');
        }
    };

    const captureAndSendRegions = () => {
        if (!videoRef.current) return;
        const tmpCanvas = document.createElement('canvas');
        const ctx = tmpCanvas.getContext('2d');
        const video = videoRef.current;

        regionsRef.current.forEach(region => {
            tmpCanvas.width = region.width;
            tmpCanvas.height = region.height;
            ctx.drawImage(video, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);

            const imageData = tmpCanvas.toDataURL('image/jpeg', 0.6);
            socketRef.current.emit('process_region_image', {
                region_index: region.index,
                image: imageData,
                timestamp: Date.now() / 1000
            });
        });
    };

    const handleStopStream = async () => {
        console.log('[DEBUG] Stopping stream');
        clearInterval(streamIntervalRef.current);
        if (mediaRecorderRef.current) mediaRecorderRef.current.stop();

        setTimeout(async () => {
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            console.log('[DEBUG] Final recording blob size:', blob.size);
            const formData = new FormData();
            formData.append('file', blob, 'recording.webm');
            formData.append('duration', Math.floor(Date.now() / 1000));

            try {
                const res = await fetch(`${API_URL}/api/recordings/${currentRecordingUuid}/upload`, {
                    method: 'POST', body: formData
                });
                const data = await res.json();
                console.log('[DEBUG] Upload response:', data);
                if (data.success) {
                    socketRef.current.emit('stop_stream');
                    navigate('/');
                } else {
                    alert('Save failed: ' + data.error);
                }
            } catch (err) {
                console.error('[DEBUG] Upload error:', err);
            }
        }, 1000);

        setIsRecording(false);
    };

    return (
        <div className="w-full h-full bg-ohif-bg text-ohif-text flex flex-col font-sans">
            {showNameModal && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                    <div className="bg-ohif-bg-muted rounded border border-ohif-border p-8 max-w-md w-full shadow-2xl">
                        <h2 className="text-xl font-bold mb-4 text-ohif-text">Start New Study</h2>
                        <div className="mb-6">
                            <label className="block text-sm font-medium text-ohif-text-muted mb-2">Study Description</label>
                            <input
                                type="text"
                                value={recordingName}
                                onChange={(e) => setRecordingName(e.target.value)}
                                placeholder="Enter description..."
                                className="w-full px-4 py-2 bg-black border border-ohif-border rounded text-ohif-text focus:border-ohif-primary outline-none transition-colors"
                                autoFocus
                                onKeyPress={(e) => e.key === 'Enter' && handleInitializeRecording()}
                            />
                        </div>

                        <div className="mb-6">
                            <label className="block text-sm font-medium text-ohif-text-muted mb-2">Select Video Source</label>
                            <select
                                className="w-full px-4 py-2 bg-black border border-ohif-border rounded text-ohif-text focus:border-ohif-primary outline-none transition-colors"
                                value={selectedDeviceId}
                                onChange={(e) => setSelectedDeviceId(e.target.value)}
                            >
                                {devices.map(device => (
                                    <option key={device.deviceId} value={device.deviceId}>
                                        {device.label || `Camera ${devices.indexOf(device) + 1}`}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="flex gap-3">
                            <Link to="/" className="flex-1 px-4 py-2 bg-transparent border border-ohif-border text-ohif-text text-center rounded hover:bg-ohif-primary/10 transition-colors">Cancel</Link>
                            <button onClick={handleInitializeRecording} className="flex-1 px-4 py-2 bg-ohif-primary text-black font-semibold rounded hover:bg-ohif-primary-hover transition-colors">Start Study</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toolbar */}
            <div className="flex-none h-12 border-b border-ohif-border flex justify-between items-center bg-ohif-bg-muted px-4">
                <div className="flex items-center gap-4">
                    <Link to="/" className="text-ohif-text-muted hover:text-ohif-text transition-colors"><ArrowLeft size={20} /></Link>
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{recordingName || 'New Study'}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${isRecording ? 'bg-red-900/50 text-red-500 border border-red-900' : 'bg-green-900/50 text-green-500 border border-green-900'}`}>
                            {isRecording ? 'REC' : 'STANDBY'}
                        </span>
                    </div>
                </div>

                <div className="flex gap-3">
                    {!isRecording ? (
                        <button
                            onClick={handleStartStream}
                            disabled={regions.length === 0}
                            className="bg-green-600 hover:bg-green-500 text-white text-xs px-4 py-1.5 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Start Capture
                        </button>
                    ) : (
                        <button
                            onClick={handleStopStream}
                            className="bg-red-600 hover:bg-red-500 text-white text-xs px-4 py-1.5 rounded font-medium animate-pulse transition-colors"
                        >
                            Stop Capture
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 flex min-h-0 bg-black">
                {/* Main Viewport */}
                <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden border-r border-ohif-border">
                    <video ref={videoRef} className="hidden" muted playsInline />
                    <canvas
                        ref={canvasRef}
                        className="max-h-full max-w-full cursor-crosshair"
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                    />

                    {/* Overlay Info */}
                    <div className="absolute top-4 left-4 text-ohif-primary text-xs font-mono pointer-events-none">
                        <p>Zoom: 100%</p>
                        <p>W/L: Default</p>
                    </div>
                </div>

                {/* Sidebar Panel */}
                <div className="w-80 bg-ohif-bg-muted flex flex-col border-l border-ohif-border">
                    <div className="p-3 border-b border-ohif-border bg-ohif-bg-muted">
                        <h3 className="text-xs font-bold text-ohif-text-muted uppercase tracking-wider">Regions</h3>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {regions.map(region => (
                            <div key={region.index} className="bg-black border border-ohif-border rounded p-2 group relative hover:border-ohif-primary transition-colors">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-xs font-bold text-ohif-primary">Region {region.index}</span>
                                    {!isRecording && (
                                        <button onClick={() => removeRegion(region.index)} className="text-ohif-text-muted hover:text-red-400 p-1 transition-colors">
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                                <div className="text-xs text-ohif-text font-mono bg-ohif-bg p-1 rounded min-h-[1.5em] border border-ohif-border">
                                    {regionTexts[region.index]?.text || "Waiting for data..."}
                                </div>
                            </div>
                        ))}
                        {regions.length === 0 && (
                            <div className="p-4 text-center">
                                <p className="text-ohif-text-muted text-xs">Draw regions on the viewer to begin tracking.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Recording;