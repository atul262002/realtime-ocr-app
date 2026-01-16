import React, { useState, useEffect } from 'react';
import { Camera, Trash2, Video, ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { Link } from 'react-router-dom';

const API_URL = 'http://localhost:5000';

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
        <div className="w-full h-full p-8 overflow-y-auto bg-ohif-bg text-ohif-text font-sans">
            <div className="w-full max-w-screen-2xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-ohif-text tracking-tight">Study List</h1>
                    <Link
                        to="/record"
                        className="bg-ohif-primary hover:bg-ohif-primary-hover px-4 py-2 rounded flex items-center gap-2 transition font-medium text-black text-sm"
                    >
                        <Camera size={16} />
                        New Capture
                    </Link>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ohif-primary"></div>
                    </div>
                ) : recordings.length === 0 ? (
                    <div className="text-center py-20 bg-ohif-bg-muted rounded border border-ohif-border">
                        <Video size={48} className="mx-auto mb-4 text-ohif-text-muted" />
                        <p className="text-ohif-text-muted">No studies found</p>
                    </div>
                ) : (
                    <div className="bg-ohif-bg-muted rounded border border-ohif-border overflow-hidden">
                        <table className="w-full text-left text-sm text-ohif-text-muted">
                            <thead className="bg-[#000] uppercase font-semibold text-ohif-primary text-xs tracking-wider border-b border-ohif-border">
                                <tr>
                                    <th className="px-6 py-4">Preview</th>
                                    <th className="px-6 py-4">Study Description</th>
                                    <th className="px-6 py-4">Regions</th>
                                    <th className="px-6 py-4">Date</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-ohif-border">
                                {recordings.map((recording) => (
                                    <tr key={recording.uuid} className="hover:bg-ohif-primary/10 transition group cursor-pointer">
                                        <td className="px-6 py-3 w-32">
                                            <Link to={`/history/${recording.uuid}`} className="block relative aspect-video bg-black rounded-sm overflow-hidden w-24 border border-ohif-border group-hover:border-ohif-primary transition-colors">
                                                {recording.thumbnail ? (
                                                    <img src={recording.thumbnail} alt="" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-ohif-text-muted"><Video size={16} /></div>
                                                )}
                                            </Link>
                                        </td>
                                        <td className="px-6 py-3 font-medium text-ohif-text max-w-xs truncate">
                                            <Link to={`/history/${recording.uuid}`} className="group-hover:text-ohif-primary transition-colors">
                                                {recording.title}
                                            </Link>
                                        </td>
                                        <td className="px-6 py-3 text-ohif-text">
                                            {recording.regions?.length || 0}
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className="text-ohif-text">{new Date(recording.created_at).toLocaleDateString()}</span>
                                            <span className="ml-2 text-ohif-text-muted text-xs">{new Date(recording.created_at).toLocaleTimeString()}</span>
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide border ${recording.status === 'completed' ? 'bg-green-900/30 text-green-400 border-green-900' : 'bg-yellow-900/30 text-yellow-400 border-yellow-900'}`}>
                                                {recording.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 text-right">
                                            <button
                                                onClick={(e) => deleteRecording(recording.uuid, e)}
                                                className="text-ohif-text-muted hover:text-red-400 transition p-2 hover:bg-black/50 rounded-full"
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
                            className="px-3 py-1 bg-ohif-bg-muted text-ohif-text text-xs rounded border border-ohif-border disabled:opacity-50 hover:bg-ohif-primary/20 transition flex items-center gap-1"
                        >
                            <ChevronLeft size={14} /> Previous
                        </button>
                        <span className="px-3 py-1 text-ohif-text-muted text-xs flex items-center">
                            Page {currentPage} of {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1 bg-ohif-bg-muted text-ohif-text text-xs rounded border border-ohif-border disabled:opacity-50 hover:bg-ohif-primary/20 transition flex items-center gap-1"
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
