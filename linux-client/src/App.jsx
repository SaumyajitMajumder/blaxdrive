import React, { useState, useEffect, useRef } from 'react';
import { WebRtcManager } from './utils/webrtc_manager';
import FileTree from './components/FileTree';

export default function App() {
  const [manager] = useState(() => new WebRtcManager());
  const [connState, setConnState] = useState('disconnected');
  const [logs, setLogs] = useState([]);
  const [directoryTree, setDirectoryTree] = useState(null);
  
  // PIN connection state
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  
  // Transfer states
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressDetails, setProgressDetails] = useState('');
  const [selectedDirectory, setSelectedDirectory] = useState('/storage/emulated/0');

  // Drag and Drop active highlight
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Modal states for File/Folder creation
  const [modalType, setModalType] = useState(null); // 'file' or 'folder'
  const [modalInputName, setModalInputName] = useState('');
  const [modalInputContent, setModalInputContent] = useState('');

  // Auto reconnect tracking
  const [isAutoReconnecting, setIsAutoReconnecting] = useState(false);

  useEffect(() => {
    // Setup callbacks
    manager.onStatus = (msg) => {
      setLogs((prev) => [...prev, `[${new Date().toISOString().substring(11, 19)}] ${msg}`].slice(-60));
    };

    manager.onConnectionState = (state) => {
      setConnState(state);
      if (state === 'connected') {
        setIsAutoReconnecting(false);
      }
    };

    manager.onTreeReceived = (tree) => {
      setDirectoryTree(tree);
    };

    manager.onTransferProgress = (percent, details) => {
      setProgressPercent(percent);
      setProgressDetails(details);
      if (percent === 100) {
        setTimeout(() => {
          setProgressPercent(0);
          setProgressDetails('');
        }, 3000);
      }
    };

    // Initialize connection interface and try auto-reconnect
    const init = async () => {
      await manager.initializeConnection();
      const hasSaved = await manager.tryAutoConnect();
      if (hasSaved) {
        setIsAutoReconnecting(true);
      }
    };
    init();

    return () => {
      manager.cleanup();
    };
  }, [manager]);

  const handleConnectWithPin = async (e) => {
    if (e) e.preventDefault();
    if (!pinInput || pinInput.length !== 6) {
      setPinError('Please enter a 6-digit PIN.');
      return;
    }
    setIsAutoReconnecting(false);
    setPinError('');
    setConnState('connecting');
    try {
      await manager.connectWithPin(pinInput);
    } catch (err) {
      setConnState('disconnected');
      setPinError(err.message || 'Failed to connect. Please try again.');
    }
  };

  const handleCreateFolder = () => {
    setModalType('folder');
  };

  const handleCreateFile = () => {
    setModalType('file');
  };

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    manager.log(`Queued ${files.length} file(s) for upload to: ${selectedDirectory}`);
    for (const file of files) {
      await manager.uploadFile(file, selectedDirectory);
    }
    e.target.value = null; // Reset value so the user can re-upload the same file if wanted
    setTimeout(() => manager.requestTree(), 1000);
  };

  // Drag & drop file uploads
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);

    if (connState !== 'connected') {
      manager.log("Cannot upload: Client is not connected to Android device.");
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    manager.log(`Queued ${files.length} file(s) for upload to: ${selectedDirectory}`);
    for (const file of files) {
      await manager.uploadFile(file, selectedDirectory);
    }
    // Refresh tree after uploads complete
    setTimeout(() => manager.requestTree(), 1000);
  };

  const handleDisconnect = () => {
    manager.cleanup();
    manager.clearSavedConnection();
    setIsAutoReconnecting(false);
    setPinInput('');
    setPinError('');
    setDirectoryTree(null);
    setSelectedDirectory('/storage/emulated/0');
  };

  const renderConnectionPanel = () => {
    if (connState === 'connecting' && !isAutoReconnecting) {
      return (
        <div className="border border-white p-6 flex flex-col items-center justify-center min-h-[300px]">
          <h2 className="text-sm font-bold mb-3 tracking-widest text-center">&gt; ESTABLISHING P2P CONNECTION</h2>
          <div className="animate-pulse text-xs mb-8 text-white/70 text-center">
            Handshaking over secure temporary signaling channel...
          </div>
          <button 
            onClick={handleDisconnect}
            className="border border-white hover:bg-white hover:text-black px-6 py-2 font-mono text-xs focus:outline-none transition-colors"
          >
            [ Cancel & Reset Connection ]
          </button>
        </div>
      );
    }

    return (
      <div className="border border-white p-6 flex flex-col items-center justify-center min-h-[300px] max-w-md mx-auto">
        <h2 className="text-sm font-bold mb-4 tracking-widest text-center">&gt; BLAXDRIVE P2P CONNECT</h2>
        
        {isAutoReconnecting && (
          <div className="w-full border border-dashed border-white/50 p-2.5 mb-4 bg-white/5 animate-pulse text-[10px] text-center text-white/80">
            🔄 AUTO-RECONNECTING TO LAST SAVED SESSION...
          </div>
        )}

        <p className="text-xs text-white/70 mb-6 text-center">
          Enter the 6-digit PIN code displayed on your Android device to initialize the direct peer-to-peer WebRTC link.
        </p>

        <form onSubmit={handleConnectWithPin} className="w-full flex flex-col items-center">
          <input
            type="text"
            maxLength={6}
            value={pinInput}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '');
              setPinInput(val);
              if (val.length === 6) setPinError('');
            }}
            placeholder="000000"
            className="bg-black text-white text-center border-2 border-white px-4 py-3 text-3xl font-mono tracking-[0.5em] mb-4 focus:outline-none w-56 placeholder-white/20 select-all"
            autoFocus
          />

          {pinError && (
            <div className="text-xs text-red-500 mb-4 font-mono text-center">
              ! ERROR: {pinError}
            </div>
          )}

          <button 
            type="submit"
            className="w-full border border-white hover:bg-white hover:text-black py-2.5 font-mono text-xs font-bold tracking-widest focus:outline-none transition-colors mb-3"
          >
            [ ESTABLISH LINK ]
          </button>

          {isAutoReconnecting && (
            <button 
              type="button"
              onClick={handleDisconnect}
              className="w-full border border-white/20 hover:border-white py-1.5 font-mono text-[10px] text-white/60 hover:text-white focus:outline-none transition-colors"
            >
              [ Clear Stale Cache / Pair New Device ]
            </button>
          )}
        </form>
      </div>
    );
  };

  const renderExplorerPanel = () => {
    return (
      <div 
        className={`flex-1 flex flex-col border border-white p-4 min-h-[350px] relative transition-colors ${
          isDragging ? 'bg-white/10' : 'bg-black'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-white pb-2 mb-3 gap-2">
          <div className="text-xs font-bold">
            &gt; EXPLORER: {selectedDirectory}
          </div>
          <div className="flex gap-2">
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileSelect} 
              multiple 
              className="hidden" 
            />
            <button 
              onClick={handleUploadClick}
              className="border border-white hover:bg-white hover:text-black px-2 py-0.5 text-[10px] focus:outline-none"
            >
              [ Upload File ]
            </button>
            <button 
              onClick={handleCreateFolder}
              className="border border-white hover:bg-white hover:text-black px-2 py-0.5 text-[10px] focus:outline-none"
            >
              [ + New Folder ]
            </button>
            <button 
              onClick={handleCreateFile}
              className="border border-white hover:bg-white hover:text-black px-2 py-0.5 text-[10px] focus:outline-none"
            >
              [ + New File ]
            </button>
            <button 
              onClick={() => manager.requestTree()}
              className="border border-white hover:bg-white hover:text-black px-2 py-0.5 text-[10px] focus:outline-none"
            >
              [ Refresh Tree ]
            </button>
            <button 
              onClick={handleDisconnect}
              className="border border-white hover:bg-white hover:text-black px-2 py-0.5 text-[10px] focus:outline-none"
            >
              [ Disconnect ]
            </button>
          </div>
        </div>

        {/* Directory View Area */}
        <div className="flex-1 overflow-y-auto max-h-[400px] border border-white/20 p-2">
          {directoryTree ? (
            <FileTree 
              node={directoryTree} 
              onDownload={(path) => manager.downloadFile(path)}
              onDelete={(path) => manager.deletePath(path)}
              onSelectDirectory={(path) => setSelectedDirectory(path)}
              selectedDirectory={selectedDirectory}
            />
          ) : (
            <div className="text-xs text-white/50 text-center py-10 italic">
              Loading directory tree...
            </div>
          )}
        </div>

        {/* Drag Drop Overlay Indicator */}
        {isDragging && (
          <div className="absolute inset-0 bg-black/90 border-2 border-dashed border-white flex items-center justify-center z-10 pointer-events-none">
            <div className="text-center font-mono">
              <p className="text-sm font-bold mb-1">[ DROP FILES HERE TO UPLOAD ]</p>
              <p className="text-xs text-white/60">Target: {selectedDirectory}</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-black text-white p-4 font-mono select-none">
      {/* Title bar */}
      <div className="border border-white p-3 flex justify-between items-center mb-4">
        <h1 className="text-base font-bold tracking-widest">BLAXDRIVE // SERVERLESS P2P STORAGE</h1>
        <div className="text-xs flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 border border-white bg-black rounded-none"></span>
          <span>SYSTEM STATE:</span>
          <span className="font-bold underline uppercase">{connState}</span>
        </div>
      </div>

      {/* Progress Monitor */}
      {progressPercent > 0 && (
        <div className="border border-white p-3 mb-4 text-xs">
          <div className="flex justify-between mb-1">
            <span>{progressDetails}</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full border border-white bg-black h-3.5 p-0.5">
            <div 
              className="bg-white h-full transition-all duration-100" 
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Main Workspace split */}
      <div className="flex-1 flex flex-col overflow-hidden gap-4">
        {connState === 'connected' ? renderExplorerPanel() : (
          <div className="flex-1 overflow-y-auto">
            {renderConnectionPanel()}
          </div>
        )}

        {/* Console Logger at bottom */}
        <div className="h-[180px] border border-white p-3 flex flex-col">
          <h3 className="text-xs font-bold border-b border-white pb-1 mb-2">&gt; STDOUT / WEBRTC_STREAM</h3>
          <div className="flex-1 overflow-y-auto font-mono text-[10px] text-white/70 space-y-1">
            {logs.map((log, index) => (
              <div key={index} className="whitespace-pre-wrap select-text">{log}</div>
            ))}
            {logs.length === 0 && <div className="italic text-white/40">No system events logged.</div>}
          </div>
        </div>
      </div>

      {/* Modals Overlay */}
      {modalType && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="border border-white bg-black p-6 w-full max-w-md font-mono text-white">
            <h2 className="text-xs font-bold border-b border-white pb-2 mb-4 uppercase tracking-wider">
              &gt; {modalType === 'folder' ? 'Create New Folder' : 'Create New File'}
            </h2>
            <div className="text-[10px] text-white/60 mb-4 select-all break-all">
              Path: {selectedDirectory}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] mb-1.5 font-bold uppercase tracking-wider">NAME:</label>
                <input 
                  type="text"
                  value={modalInputName}
                  onChange={(e) => setModalInputName(e.target.value)}
                  placeholder={modalType === 'folder' ? 'New Directory Name' : 'notes.txt'}
                  className="w-full bg-black border border-white p-2 text-xs font-mono text-white focus:outline-none"
                  autoFocus
                />
              </div>

              {modalType === 'file' && (
                <div>
                  <label className="block text-[10px] mb-1.5 font-bold uppercase tracking-wider">CONTENT (OPTIONAL):</label>
                  <textarea 
                    value={modalInputContent}
                    onChange={(e) => setModalInputContent(e.target.value)}
                    placeholder="Enter file text content here..."
                    rows={5}
                    className="w-full bg-black border border-white p-2 text-xs font-mono text-white focus:outline-none resize-none"
                  />
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button 
                  onClick={() => {
                    setModalType(null);
                    setModalInputName('');
                    setModalInputContent('');
                  }}
                  className="border border-white/50 hover:border-white px-3 py-1 text-xs focus:outline-none"
                >
                  [ Cancel ]
                </button>
                <button 
                  onClick={() => {
                    if (!modalInputName.trim()) {
                      return;
                    }
                    if (modalType === 'folder') {
                      manager.createFolder(selectedDirectory, modalInputName.trim());
                    } else {
                      manager.createFile(selectedDirectory, modalInputName.trim(), modalInputContent);
                    }
                    setModalType(null);
                    setModalInputName('');
                    setModalInputContent('');
                  }}
                  className="border border-white hover:bg-white hover:text-black px-3 py-1 text-xs font-bold focus:outline-none"
                >
                  [ Confirm ]
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
