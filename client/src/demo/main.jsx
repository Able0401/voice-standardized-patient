import React from 'react';
import { createRoot } from 'react-dom/client';
import DemoApp from './DemoApp.jsx';
import '../styles/global.css';
import './demo.css';

// Entry point (index.html). The page has no router, no database client, and no case data.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DemoApp />
  </React.StrictMode>
);
