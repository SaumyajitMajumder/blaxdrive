import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ViewerApp from './components/ViewerApp.jsx'
import './index.css'

const isViewer = window.location.search.includes('mode=viewer') || window.location.hash.includes('viewer');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isViewer ? <ViewerApp /> : <App />}
  </React.StrictMode>,
)
