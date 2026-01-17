import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Clock, FileText, Copy, Check } from 'lucide-react';
import { useParams, Link } from 'react-router-dom';

const API_URL = 'http://localhost:5000';

function RegionCard({ region }) {
    const [copied, setCopied] = useState(false);
    const uniqueWords = [...new Set(region.words.map(w => w.word))];
    const textToCopy = uniqueWords.join(', ');

    const handleCopy = async () => {
        await navigator.clipboard.writeText(textToCopy);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600 hover:border-blue-500 transition group">
            <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold text-blue-300">Region {region.region_index}</h3>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded">
                        {region.words.length} words
                    </span>
                    <button
                        onClick={handleCopy}
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-ohif-primary ohif-bg-popover-hover text-white rounded transition"
                    >
                        {copied ? (
                            <>
                                <Check size={12} /> Copied
                            </>
                        ) : (
                            <>
                                <Copy size={12} /> Copy
                            </>
                        )}
                    </button>
                </div>
            </div>

            <div className="text-sm text-gray-300 leading-relaxed font-mono bg-black/20 p-2 rounded">
                {region.words.length > 0 ? (
                    uniqueWords.join(', ')
                ) : (
                    <span className="text-gray-500 italic">No text detected</span>
                )}
            </div>
        </div>
    );
}

function HistoryDetail() {
    const { uuid } = useParams();
    const [recording, setRecording] = useState(null);
    const [loading, setLoading] = useState(true);
    const videoRef = useRef(null);

    const fetchRecordingDetails = async () => {
        try {
            const response = await fetch(`${API_URL}/api/recordings/${uuid}`);
            const data = await response.json();
            if (data.success) {
                setRecording(data.data);
            } else {
                alert('Failed to load recording: ' + data.error);
            }
        } catch (error) {
            console.error('Error fetching recording:', error);
            alert('Error connecting to server');
        }
        setLoading(false);
    };

    useEffect(() => {
        const fetchData = async () => {
            await fetchRecordingDetails();
        };
        fetchData();
    }, [uuid]);

    const videoUrl = recording?.filename ? `${API_URL}/uploads/${recording.uuid}_${recording.filename}` : null;

    if (loading) {
        return (
            <div className="w-full h-full flex items-center justify-center text-white">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    if (!recording) {
        return (
            <div className="w-full h-full p-8 text-white">
                <div className="max-w-4xl mx-auto">
                    <Link to="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-8 transition">
                        <ArrowLeft size={20} /> Back to List
                    </Link>
                    <div className="bg-red-500/10 border border-red-500/50 p-6 rounded-lg text-center">
                        <p className="text-red-400">Recording not found.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full p-6 text-white overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6 flex-shrink-0">
                <Link to="/" className="p-2 hover:bg-gray-800 rounded-full transition text-gray-400 hover:text-white">
                    <ArrowLeft size={24} />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">{recording.title}</h1>
                    <div className="flex items-center gap-4 text-sm text-gray-400 mt-1">
                        <span className="flex items-center gap-1"><Clock size={14} /> {new Date(recording.created_at).toLocaleString()}</span>
                        <span className="bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded text-xs">{recording.status}</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 flex gap-6 min-h-0">
                {/* Main Video Area */}
                <div className="flex-1 bg-black rounded-xl overflow-hidden relative flex items-center justify-center border border-gray-800 shadow-2xl">
                    {videoUrl ? (
                        <div className="relative w-full h-full flex items-center justify-center">
                            <video
                                ref={videoRef}
                                src={videoUrl}
                                controls
                                className="max-w-full max-h-full object-contain"
                            />
                        </div>
                    ) : (
                        <div className="text-gray-500">Video file not available</div>
                    )}
                </div>

                {/* Sidebar - Results */}
                <div className="w-96 bg-ohif-bg rounded-xl border border-gray-700 flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-gray-700 bg-ohif-bg-muted">
                        <h2 className="font-bold flex items-center gap-2">
                            <FileText size={20} className="text-blue-400" />
                            OCR Regions ({recording.regions.length})
                        </h2>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {recording.regions.map((region) => (
                            <RegionCard key={region.id} region={region} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default HistoryDetail;