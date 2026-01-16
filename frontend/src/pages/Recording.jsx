import React, { useState, useRef, useEffect } from 'react';
import { Square, ArrowLeft, X } from 'lucide-react';
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

    // Refs
    const videoRef = useRef(null); // Hidden source video
    const canvasRef = useRef(null); // Visible & Recorded Canvas
    const mediaRecorderRef = useRef(null);
    const recordedChunksRef = useRef([]);
    const streamIntervalRef = useRef(null);
    const requestRef = useRef(null); // RequestAnimationFrame
    const socketRef = useRef(null);
    const containerRef = useRef(null);

    useEffect(() => {
        initializeSocket();
        startCamera();

        return () => {
            stopEverything();
        };
    }, []);

    // Main Render Loop
    useEffect(() => {
        const render = () => {
            if (canvasRef.current && videoRef.current && videoRef.current.readyState === 4) {
                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d');
                const video = videoRef.current;

                // 1. Draw Video Frame
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // 2. Draw Regions (Burn-in)
                regions.forEach(region => {
                    // Stroke
                    ctx.strokeStyle = '#3b82f6'; // blue-500
                    ctx.lineWidth = 3;
                    ctx.strokeRect(region.x, region.y, region.width, region.height);

                    // Label Background
                    ctx.fillStyle = '#2563eb'; // blue-600
                    ctx.fillRect(region.x, region.y - 20, 70, 20);

                    // Label Text
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 12px Arial';
                    ctx.fillText(`Region ${region.index}`, region.x + 5, region.y - 6);

                    // Live Text Result (if any)
                    // Let's show it below the box or inside
                    const result = regionTexts[region.index];
                    if (result && result.text) {
                        // Measuring text to draw background box
                        const text = result.text.length > 30 ? result.text.substring(0, 30) + '...' : result.text;
                        ctx.font = '14px sans-serif';
                        const textWidth = ctx.measureText(text).width;

                        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                        ctx.fillRect(region.x, region.y + region.height, textWidth + 10, 24);

                        ctx.fillStyle = '#ffffff';
                        ctx.fillText(text, region.x + 5, region.y + region.height + 17);
                    }
                });

                // 3. Draw Temp Drawing Region
                if (tempRegion) {
                    ctx.strokeStyle = '#facc15'; // yellow-400
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5, 5]);
                    ctx.strokeRect(tempRegion.x, tempRegion.y, tempRegion.width, tempRegion.height);
                    ctx.setLineDash([]); // Reset
                }

            }
            requestRef.current = requestAnimationFrame(render);
        };

        requestRef.current = requestAnimationFrame(render);

        // Cancel loop on unmount
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [regions, tempRegion, regionTexts]); // Re-bind when data changes if needed, actually refs are stable but arrays change. 
    // Ideally, use refs for regions in the loop to avoid re-binding, but for react state simplicity we might just depend on state updates triggering re-renders of this effect.
    // Optimization: Use a ref for 'regions' that gets updated whenever state 'regions' changes, so the loop doesn't restart.

    // Ref approach for render loop data
    const regionsRef = useRef(regions);
    const tempRegionRef = useRef(tempRegion);
    const regionTextsRef = useRef(regionTexts);

    useEffect(() => { regionsRef.current = regions; }, [regions]);
    useEffect(() => { tempRegionRef.current = tempRegion; }, [tempRegion]);
    useEffect(() => { regionTextsRef.current = regionTexts; }, [regionTexts]);

    // Optimized Render Loop using Refs (replaces previous one)
    useEffect(() => {
        // Kill previous loop if any
        if (requestRef.current) cancelAnimationFrame(requestRef.current);

        const render = () => {
            if (canvasRef.current && videoRef.current && videoRef.current.readyState === 4) {
                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d');
                const video = videoRef.current;

                // Ensure canvas matches video dims (once or check)
                // Ideally set once. 
                if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
                if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

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
                        // Dedup for display if needed? Backend sends full text usually.
                        // The user wants "unique result" in history, but here we can show latest.
                        const text = result.text;
                        if (text) {
                            const maxW = 300;
                            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                            ctx.fillRect(region.x, region.y + region.height, Math.min(region.width, maxW), 30);

                            ctx.fillStyle = '#10b981'; // green-500
                            ctx.font = 'bold 16px monospace';
                            ctx.fillText(text.slice(-30), region.x + 5, region.y + region.height + 20); // Show last chars
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
            }
            requestRef.current = requestAnimationFrame(render);
        };
        requestRef.current = requestAnimationFrame(render);
        return () => cancelAnimationFrame(requestRef.current);
    }, []);


    const stopEverything = () => {
        if (socketRef.current) socketRef.current.close();
        if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
        if (videoRef.current && videoRef.current.srcObject) {
            videoRef.current.srcObject.getTracks().forEach(track => track.stop());
        }
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };

    const initializeSocket = () => {
        import('https://cdn.socket.io/4.5.4/socket.io.min.js').then(() => {
            socketRef.current = window.io(API_URL);

            socketRef.current.on('connect', () => console.log('Connected to server'));

            socketRef.current.on('region_text_result', (data) => {
                setRegionTexts(prev => ({
                    ...prev,
                    [data.region_index]: {
                        text: data.text,
                        timestamp: data.timestamp,
                        words: data.words
                    }
                }));
            });
        });
    };

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720 },
                audio: true
            });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                // Wait for metadata to set canvas size
                videoRef.current.onloadedmetadata = () => {
                    if (canvasRef.current) {
                        canvasRef.current.width = videoRef.current.videoWidth;
                        canvasRef.current.height = videoRef.current.videoHeight;
                    }
                };
            }
        } catch (error) {
            console.error('Error accessing camera:', error);
            alert('Failed to access camera.');
        }
    };

    const handleInitializeRecording = async () => {
        if (!recordingName.trim()) return;

        try {
            const response = await fetch(`${API_URL}/api/recordings/initialize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: recordingName, num_regions: 0 })
            });
            const data = await response.json();
            if (data.success) {
                setCurrentRecordingUuid(data.data.recording_uuid);
                setShowNameModal(false);
            }
        } catch (error) {
            console.error(error);
            alert('Failed to initialize recording');
        }
    };

    // --- Drawing Logic ---
    // Coordinates need to be mapped if canvas is scaled CSS-wise. 
    // For now, assuming canvas 'w-full h-full' with object-contain might mess up mouse coords relative to internal resolution.
    // Best practice: Display canvas at natural resolution or calculate scale accurately.
    // Let's rely on getBoundingClientRect and scale map.

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
            setRegions([...regions, { ...tempRegion, index: regions.length }]);
        }
        setTempRegion(null);
        setDrawStart(null);
    };

    const removeRegion = (index) => {
        setRegions(regions.filter(r => r.index !== index).map((r, i) => ({ ...r, index: i })));
    };


    // --- Streaming/Recording Logic ---

    const handleStartStream = async () => {
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

            // KEY CHANGE: Record the CANVAS stream, not the video stream
            const stream = canvasRef.current.captureStream(30); // 30 FPS

            // Add audio? We need to get audio track from getUserMedia and mix it?
            // For simplicity, let's just record video (canvas) for now or try to mix.
            // If we want audio, we need to grab the audio track from videoRef.current.srcObject
            if (videoRef.current.srcObject) {
                const audioTracks = videoRef.current.srcObject.getAudioTracks();
                if (audioTracks.length > 0) {
                    stream.addTrack(audioTracks[0]);
                }
            }

            try {
                mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'video/webm' });
            } catch (e) {
                mediaRecorderRef.current = new MediaRecorder(stream);
            }

            mediaRecorderRef.current.ondataavailable = (e) => {
                if (e.data.size > 0) recordedChunksRef.current.push(e.data);
            };
            mediaRecorderRef.current.start(1000);

            setIsRecording(true);

            socketRef.current.emit('start_stream', { recording_uuid: currentRecordingUuid });
            streamIntervalRef.current = setInterval(captureAndSendRegions, 1000);

        } catch (error) {
            console.error(error);
            alert('Failed to start recording');
        }
    };

    const captureAndSendRegions = () => {
        // Just extract image data from canvas areas
        // Since canvas gives us the "burned in" look, do we want to send the raw video pixels or the annotated pixels?
        // Usually OCR needs raw pixels.
        // So we should probably draw the raw video to a temporary canvas to extract clean patches, 
        // OR just grab from the current canvas (which has box outlines).
        // Box outlines might confuse OCR. 
        // Better: Use a helper canvas to crop from raw video.

        if (!videoRef.current) return;

        const tmpCanvas = document.createElement('canvas');
        const ctx = tmpCanvas.getContext('2d');
        const video = videoRef.current;

        regionsRef.current.forEach(region => {
            tmpCanvas.width = region.width;
            tmpCanvas.height = region.height;
            // Crop from video
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
        clearInterval(streamIntervalRef.current);
        if (mediaRecorderRef.current) mediaRecorderRef.current.stop();

        setTimeout(async () => {
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            const formData = new FormData();
            formData.append('file', blob, 'recording.webm');
            formData.append('duration', Math.floor(Date.now() / 1000));

            try {
                const res = await fetch(`${API_URL}/api/recordings/${currentRecordingUuid}/upload`, {
                    method: 'POST', body: formData
                });
                const data = await res.json();
                if (data.success) {
                    socketRef.current.emit('stop_stream');
                    navigate('/');
                } else {
                    alert('Save failed: ' + data.error);
                }
            } catch (err) {
                console.error(err);
            }
        }, 1000);

        setIsRecording(false);
    };

    return (
        <div className="w-full h-full bg-gray-900 text-white flex flex-col">
            {showNameModal && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-800 rounded-xl p-8 max-w-md w-full border border-gray-700">
                        <h2 className="text-2xl font-bold mb-4">Start Session</h2>
                        <input
                            type="text"
                            value={recordingName}
                            onChange={(e) => setRecordingName(e.target.value)}
                            placeholder="Enter session name..."
                            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg mb-6 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            autoFocus
                            onKeyPress={(e) => e.key === 'Enter' && handleInitializeRecording()}
                        />
                        <div className="flex gap-3">
                            <Link to="/" className="flex-1 px-4 py-3 bg-gray-700 text-center rounded-lg hover:bg-gray-600">Cancel</Link>
                            <button onClick={handleInitializeRecording} className="flex-1 px-4 py-3 bg-blue-600 rounded-lg hover:bg-blue-700 font-bold">Start</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex-none p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900">
                <div className="flex items-center gap-4">
                    <Link to="/" className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white"><ArrowLeft size={24} /></Link>
                    <div>
                        <h1 className="text-xl font-bold">{recordingName || 'New Recording'}</h1>
                        <p className="text-sm text-gray-500">{isRecording ? 'REC' : 'Standby'}</p>
                    </div>
                </div>

                <div className="flex gap-4">
                    {!isRecording ? (
                        <button onClick={handleStartStream} disabled={regions.length === 0} className="bg-green-600 hover:bg-green-700 disabled:bg-gray-700 px-8 py-2 rounded-lg font-bold shadow-lg shadow-green-500/20">
                            Start Recording
                        </button>
                    ) : (
                        <button onClick={handleStopStream} className="bg-red-600 hover:bg-red-700 px-8 py-2 rounded-lg font-bold shadow-lg shadow-red-500/20 animate-pulse">
                            Stop Recording
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 flex min-h-0 bg-black">
                {/* Canvas Area */}
                <div className="flex-1 relative flex items-center justify-center bg-gray-900 overflow-hidden">
                    <video ref={videoRef} className="hidden" muted playsInline autoPlay />
                    <canvas
                        ref={canvasRef}
                        className="max-h-full max-w-full cursor-crosshair shadow-2xl"
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                    />

                    {/* Delete buttons overlay (HTML for interactivity, since canvas buttons are hard) */}
                    {/* We map regions to screen coordinates to overlay delete buttons. 
                    However, with scaling canvas 'max-w-full', it's tricky to map exactly.
                    Easiest way: Just rely on keyboard or put a list on the side to delete.
                    Let's put a "Clear All" or list on the side for now to be safe,
                    OR mapping logic again.
                    Let's skip deletion via canvas click for this iteration to ensure stability, 
                    users can delete from the side list if we add one, or we just rely on "Undo" (not implemented).
                    Actually, we can use the Sidebar to delete regions!
                */}
                </div>

                {/* Sidebar Results / Regions */}
                <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col">
                    <div className="p-4 border-b border-gray-800 bg-gray-900">
                        <h3 className="font-bold text-gray-300">Regions & Results</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {regions.map(region => (
                            <div key={region.index} className="bg-gray-800 rounded p-3 border border-gray-700 group relative">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-xs font-bold text-blue-400">Region {region.index}</span>
                                    {!isRecording && (
                                        <button onClick={() => removeRegion(region.index)} className="text-red-500 hover:text-red-400 p-1">
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                                <p className="text-sm text-gray-300 min-h-[1.5em] font-mono bg-black/30 p-1 rounded">
                                    {regionTexts[region.index]?.text || "..."}
                                </p>
                            </div>
                        ))}
                        {regions.length === 0 && (
                            <p className="text-gray-600 text-center text-sm py-4">Draw distinct regions on the video to track.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Recording;
