import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HistoryList from './pages/HistoryList';
import HistoryDetail from './pages/HistoryDetail';
import Recording from './pages/Recording';

function App() {
  return (
    <BrowserRouter>
      <div className="w-full h-screen bg-ohif-bg text-ohif-text overflow-hidden flex flex-col">
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