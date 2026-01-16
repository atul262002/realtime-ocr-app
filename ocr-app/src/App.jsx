import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HistoryList from './pages/HistoryList';
import HistoryDetail from './pages/HistoryDetail';
import Recording from './pages/Recording';

function App() {
  return (
    <BrowserRouter>
      <div className="w-full h-screen bg-gray-900 text-white overflow-hidden">
        <Routes>
          <Route path="/" element={<HistoryList />} />
          <Route path="/history/:uuid" element={<HistoryDetail />} />
          <Route path="/record" element={<Recording />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
