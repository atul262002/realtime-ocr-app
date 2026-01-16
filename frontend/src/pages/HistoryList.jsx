import React, { useState, useEffect } from 'react';
import { Camera, Trash2, Video, ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { Link } from 'react-router-dom';

const API_URL = 'http://10.194.161.181:5000';

function HistoryList() {
    const [recordings, setRecordings] = useState([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchRecordings();
    }, [currentPage]);

    const fetchRecordings = async (page = currentPage) => {
        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/api/recordings?page=${page}&per_page=12`);
            const data = await response.json();
            if (data.success) {
                setRecordings(data.data.recordings);
                setTotalPages(data.data.total_pages);
                setCurrentPage(page);
            }
        } catch (error) {
            console.error('Error fetching recordings:', error);
            alert('Cannot connect to backend.');
        }
        setLoading(false);
    };

    const deleteRecording = async (uuid, e) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete this recording?')) return;

        try {
            const response = await fetch(`${API_URL}/api/recordings/${uuid}`, { method: 'DELETE' });
            const data = await response.json();
            if (data.success) {
                fetchRecordings(currentPage);
            }
        } catch (error) {
            console.error('Error deleting recording:', error);
        }
    };

    return (
        <div className="w-full h-full p-6 overflow-y-auto">
            <div className="w-full max-w-screen-2xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-white">My Recordings</h1>
                    <Link
                        to="/record"
                        className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg flex items-center gap-2 transition font-semibold text-white text-sm"
                    >
                        <Camera size={16} />
                        New Recording
                    </Link>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    </div>
                ) : recordings.length === 0 ? (
                    <div className="text-center py-20 bg-gray-800 rounded-xl border border-gray-700">
                        <Video size={48} className="mx-auto mb-4 text-gray-600" />
                        <p className="text-gray-400">No recordings yet</p>
                    </div>
                ) : (
                    <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700 shadow-xl">
                        <table className="w-full text-left text-gray-400 text-sm">
                            <thead className="bg-gray-900 uppercase font-medium text-gray-500 text-xs">
                                <tr>
                                    <th className="px-6 py-4">Thumbnail</th>
                                    <th className="px-6 py-4">Title</th>
                                    <th className="px-6 py-4">Regions</th>
                                    <th className="px-6 py-4">Date</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {recordings.map((recording) => (
                                    <tr key={recording.uuid} className="hover:bg-gray-750 transition group">
                                        <td className="px-6 py-3 w-32">
                                            <Link to={`/history/${recording.uuid}`} className="block relative aspect-video bg-black rounded overflow-hidden w-24 border border-gray-600">
                                                {recording.thumbnail ? (
                                                    <img src={recording.thumbnail} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-700"><Video size={16} /></div>
                                                )}
                                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                                                    <Play size={16} className="text-white" fill="currentColor" />
                                                </div>
                                            </Link>
                                        </td>
                                        <td className="px-6 py-3 font-medium text-white max-w-xs truncate">
                                            <Link to={`/history/${recording.uuid}`} className="hover:text-blue-400 transition">
                                                {recording.title}
                                            </Link>
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className="bg-gray-700 text-gray-300 px-2 py-1 rounded text-xs">{recording.regions?.length || 0} regions</span>
                                        </td>
                                        <td className="px-6 py-3">
                                            {new Date(recording.created_at).toLocaleDateString()} <span className="text-gray-600 text-xs">{new Date(recording.created_at).toLocaleTimeString()}</span>
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wide ${recording.status === 'completed' ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                                                {recording.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 text-right">
                                            <button
                                                onClick={(e) => deleteRecording(recording.uuid, e)}
                                                className="text-gray-500 hover:text-red-400 transition p-2 hover:bg-gray-700 rounded-full"
                                                title="Delete"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {totalPages > 1 && (
                    <div className="flex justify-end gap-2 mt-6">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1 bg-gray-800 text-white text-xs rounded disabled:opacity-50 hover:bg-gray-700 transition flex items-center gap-1"
                        >
                            <ChevronLeft size={14} /> Previous
                        </button>
                        <span className="px-3 py-1 bg-gray-800 text-gray-400 text-xs rounded flex items-center">
                            Page {currentPage} of {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1 bg-gray-800 text-white text-xs rounded disabled:opacity-50 hover:bg-gray-700 transition flex items-center gap-1"
                        >
                            Next <ChevronRight size={14} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default HistoryList;
