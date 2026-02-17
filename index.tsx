import React from 'react';
import './src/styles.css';
import ReactDOM from 'react-dom/client';
import { RigCoreV2Shell } from './src/rig-adapter/RigCoreV2Shell';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <RigCoreV2Shell />
  </React.StrictMode>
);
