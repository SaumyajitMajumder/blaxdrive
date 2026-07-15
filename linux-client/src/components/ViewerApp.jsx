import React, { useState, useEffect, useRef } from 'react';

const channel = new BroadcastChannel('blaxdrive_viewer');

export default function ViewerApp() {
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  
  // Image zoom scale state (resets when active tab changes)
  const [zoomScale, setZoomScale] = useState(1);
  const [copySuccess, setCopySuccess] = useState(false);

  // Notify main window that viewer is ready to receive
  useEffect(() => {
    channel.postMessage({ type: 'VIEWER_READY' });

    const handleMessage = (event) => {
      const msg = event.data;
      if (msg && msg.type === 'OPEN_FILE') {
        const { name, type, textContent, blob } = msg.file;

        setTabs((prevTabs) => {
          // Check if file is already open
          const existingTab = prevTabs.find((t) => t.name === name);
          if (existingTab) {
            setActiveTabId(existingTab.id);
            return prevTabs;
          }

          // Create localized Object URL for viewing the blob
          const contentUrl = blob ? URL.createObjectURL(blob) : '';
          const newTab = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            name,
            type,
            contentUrl,
            textContent,
            blob
          };

          setActiveTabId(newTab.id);
          setZoomScale(1); // Reset zoom scale on new tab opening
          return [...prevTabs, newTab];
        });
      }
    };

    channel.addEventListener('message', handleMessage);

    // Clean up channel and all object URLs on unmount
    return () => {
      channel.removeEventListener('message', handleMessage);
      tabs.forEach((tab) => {
        if (tab.contentUrl) {
          URL.revokeObjectURL(tab.contentUrl);
        }
      });
    };
  }, [tabs]);

  // Tab closing logic
  const handleCloseTab = (id, e) => {
    if (e) e.stopPropagation();

    setTabs((prevTabs) => {
      const tabToClose = prevTabs.find((t) => t.id === id);
      if (tabToClose && tabToClose.contentUrl) {
        URL.revokeObjectURL(tabToClose.contentUrl);
      }

      const remainingTabs = prevTabs.filter((t) => t.id !== id);

      if (activeTabId === id) {
        if (remainingTabs.length > 0) {
          const closedIndex = prevTabs.findIndex((t) => t.id === id);
          const nextActiveIndex = Math.max(0, closedIndex - 1);
          setActiveTabId(remainingTabs[nextActiveIndex].id);
        } else {
          setActiveTabId(null);
        }
      }

      return remainingTabs;
    });
  };

  const handleCloseAll = () => {
    tabs.forEach((tab) => {
      if (tab.contentUrl) URL.revokeObjectURL(tab.contentUrl);
    });
    setTabs([]);
    setActiveTabId(null);
  };

  const handleCloseOthers = (id) => {
    tabs.forEach((tab) => {
      if (tab.id !== id && tab.contentUrl) {
        URL.revokeObjectURL(tab.contentUrl);
      }
    });
    const keptTab = tabs.find((t) => t.id === id);
    setTabs(keptTab ? [keptTab] : []);
    setActiveTabId(keptTab ? keptTab.id : null);
  };

  // Switch tab action
  const handleSelectTab = (id) => {
    setActiveTabId(id);
    setZoomScale(1); // Reset zoom scale
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // File type icons mapping
  const getTabIcon = (type) => {
    switch (type) {
      case 'image': return '🖼️';
      case 'pdf': return '📄';
      case 'text': return '📝';
      case 'media': return '🎵';
      default: return '📦';
    }
  };

  // Download action inside the viewer
  const handleDownload = (tab) => {
    if (!tab || !tab.contentUrl) return;
    const a = document.createElement('a');
    a.href = tab.contentUrl;
    a.download = tab.name;
    a.click();
  };

  // Copy text content to clipboard
  const handleCopyText = (text) => {
    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-black text-white p-4 font-mono select-none">
      
      {/* Title bar */}
      <div className="border border-white p-3 flex justify-between items-center mb-4 flex-shrink-0">
        <h1 className="text-base font-bold tracking-widest">BLAXDRIVE // MULTI-TAB FILE VIEWER</h1>
        <div className="text-xs flex items-center gap-2">
          <span className="inline-block w-2 h-2 bg-emerald-500 rounded-full animate-ping"></span>
          <span>CHANNELS ACTIVE</span>
        </div>
      </div>

      {/* Main Tab System Panel */}
      <div className="flex-1 flex flex-col border border-white overflow-hidden bg-black">
        
        {/* Browser Tabs Row */}
        <div className="flex items-center justify-between border-b border-white bg-neutral-950 flex-shrink-0">
          <div className="flex-1 flex overflow-x-auto scrollbar-thin scrollbar-thumb-white/20 select-none">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => handleSelectTab(tab.id)}
                  className={`group relative flex items-center gap-2 px-4 py-2.5 text-xs border-r border-white cursor-pointer select-none transition-all duration-150 max-w-[200px] min-w-[120px] ${
                    isActive 
                      ? 'bg-black text-white font-bold border-b-2 border-b-cyan-400' 
                      : 'bg-neutral-900 text-white/50 hover:bg-neutral-850 hover:text-white/80'
                  }`}
                >
                  <span className="text-sm flex-shrink-0">{getTabIcon(tab.type)}</span>
                  <span className="truncate flex-1 pr-4">{tab.name}</span>
                  <button
                    onClick={(e) => handleCloseTab(tab.id, e)}
                    className="absolute right-2 opacity-50 group-hover:opacity-100 hover:bg-white/10 hover:text-red-500 rounded px-1 text-[10px] font-mono leading-none transition-all"
                    title="Close tab"
                  >
                    ×
                  </button>
                </div>
              );
            })}

            {tabs.length === 0 && (
              <div className="text-xs text-white/30 italic p-3">
                No active tabs
              </div>
            )}
          </div>

          {/* Quick tab controls */}
          {tabs.length > 0 && (
            <div className="flex gap-1.5 px-3 flex-shrink-0 text-[10px]">
              <button
                onClick={() => handleCloseOthers(activeTabId)}
                className="border border-white/20 hover:border-white hover:bg-white hover:text-black px-2 py-0.5 transition-colors"
              >
                [ Close Others ]
              </button>
              <button
                onClick={handleCloseAll}
                className="border border-white/20 hover:border-white hover:bg-white hover:text-black px-2 py-0.5 transition-colors"
              >
                [ Close All ]
              </button>
            </div>
          )}
        </div>

        {/* Tab Content display area */}
        <div className="flex-1 overflow-hidden relative bg-black flex flex-col">
          {activeTab ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              
              {/* Context Toolbar */}
              <div className="flex justify-between items-center border-b border-white/20 px-3 py-1.5 bg-neutral-950 flex-shrink-0">
                <span className="text-[10px] text-white/60 truncate font-mono">
                  FILE: {activeTab.name} | TYPE: {activeTab.type.toUpperCase()}
                </span>
                
                {/* Specific controls based on file types */}
                <div className="flex gap-2">
                  {activeTab.type === 'image' && (
                    <div className="flex gap-1.5 items-center mr-2 border-r border-white/20 pr-3">
                      <button
                        onClick={() => setZoomScale(prev => Math.max(0.25, prev - 0.25))}
                        className="border border-white/40 hover:border-white px-2 py-0.5 text-[10px]"
                        title="Zoom Out"
                      >
                        [ - ]
                      </button>
                      <span className="text-[10px] w-12 text-center font-mono">{Math.round(zoomScale * 100)}%</span>
                      <button
                        onClick={() => setZoomScale(prev => Math.min(4, prev + 0.25))}
                        className="border border-white/40 hover:border-white px-2 py-0.5 text-[10px]"
                        title="Zoom In"
                      >
                        [ + ]
                      </button>
                      <button
                        onClick={() => setZoomScale(1)}
                        className="border border-white/40 hover:border-white px-2 py-0.5 text-[10px]"
                      >
                        [ Reset ]
                      </button>
                    </div>
                  )}

                  {activeTab.type === 'text' && (
                    <button
                      onClick={() => handleCopyText(activeTab.textContent)}
                      className="border border-white/40 hover:border-white px-2.5 py-0.5 text-[10px]"
                    >
                      {copySuccess ? '[ Copied! ]' : '[ Copy to Clipboard ]'}
                    </button>
                  )}

                  <button
                    onClick={() => handleDownload(activeTab)}
                    className="border border-white hover:bg-white hover:text-black px-2.5 py-0.5 text-[10px] font-bold"
                  >
                    [ Download File ]
                  </button>
                </div>
              </div>

              {/* Renderers */}
              <div className="flex-1 overflow-hidden relative flex items-center justify-center p-4 bg-neutral-900/40">
                
                {activeTab.type === 'image' && (
                  <div className="w-full h-full overflow-auto flex items-center justify-center">
                    <img
                      src={activeTab.contentUrl}
                      style={{ transform: `scale(${zoomScale})`, transformOrigin: 'center center' }}
                      className="max-w-full max-h-full object-contain transition-transform duration-100 ease-out select-text"
                      alt={activeTab.name}
                    />
                  </div>
                )}

                {activeTab.type === 'pdf' && (
                  <iframe
                    src={activeTab.contentUrl}
                    className="w-full h-full border-0 bg-neutral-950"
                    title="PDF Viewer"
                  />
                )}

                {activeTab.type === 'text' && (
                  <div className="w-full h-full overflow-auto bg-neutral-950 p-4 border border-white/10 flex">
                    {/* Line numbers panel */}
                    <div className="text-right pr-4 border-r border-white/10 text-white/30 select-none font-mono text-xs leading-5">
                      {activeTab.textContent.split('\n').map((_, index) => (
                        <div key={index}>{index + 1}</div>
                      ))}
                    </div>
                    {/* Code contents */}
                    <pre className="flex-1 pl-4 text-left text-xs text-white/90 select-text whitespace-pre font-mono leading-5 overflow-x-auto">
                      {activeTab.textContent}
                    </pre>
                  </div>
                )}

                {activeTab.type === 'media' && (
                  <div className="max-w-3xl w-full flex justify-center">
                    {activeTab.name.endsWith('.mp4') || activeTab.name.endsWith('.webm') ? (
                      <video
                        src={activeTab.contentUrl}
                        controls
                        className="max-w-full max-h-[80vh] border border-white/20 bg-black"
                      />
                    ) : (
                      <div className="w-full bg-neutral-950 p-6 border border-white/20 flex flex-col items-center gap-4">
                        <div className="text-5xl">🎵</div>
                        <div className="text-xs text-white/60 truncate max-w-md">{activeTab.name}</div>
                        <audio src={activeTab.contentUrl} controls className="w-full" />
                      </div>
                    )}
                  </div>
                )}

                {activeTab.type === 'unknown' && (
                  <div className="text-center p-8 border border-dashed border-white/20 max-w-md bg-neutral-950/60 font-mono">
                    <div className="text-3xl mb-4">📦</div>
                    <h3 className="text-sm font-bold mb-2">No Inline Preview Available</h3>
                    <p className="text-xs text-white/60 mb-6">
                      BlaxDrive does not support displaying this file type ({activeTab.name.split('.').pop()}) directly inside the app browser.
                    </p>
                    <button
                      onClick={() => handleDownload(activeTab)}
                      className="border border-white hover:bg-white hover:text-black px-4 py-2 text-xs font-bold transition-all"
                    >
                      [ Download and Open Locally ]
                    </button>
                  </div>
                )}

              </div>

            </div>
          ) : (
            
            /* Empty State Screen */
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none bg-neutral-950">
              <div className="w-20 h-20 mb-6 border border-white/20 flex items-center justify-center relative bg-black/40">
                <div className="w-16 h-16 border border-white/10 absolute animate-pulse"></div>
                <div className="text-3xl animate-bounce">📺</div>
              </div>
              
              <h2 className="text-sm font-bold tracking-widest mb-3 uppercase">
                &gt; BLAXDRIVE FILE VIEWER
              </h2>
              
              <div className="max-w-md space-y-4">
                <p className="text-xs text-white/70 leading-5">
                  This window acts as your multi-tab file explorer dashboard. Use the main BlaxDrive interface to navigate and click <span className="underline">[ View ]</span> on files.
                </p>
                <div className="border border-dashed border-white/25 p-3.5 bg-black font-mono text-[10px] text-white/50 text-left leading-relaxed">
                  <div className="flex items-center gap-2 mb-1.5 text-white/70">
                    <span className="w-1.5 h-1.5 bg-cyan-400 rounded-none inline-block"></span>
                    <span>RECEIVER STATUS: ACTIVE</span>
                  </div>
                  <div>- Supports: PDF, TXT, JSON, MD, PNG, JPG, WEBP, MP4, MP3, WAV...</div>
                  <div>- Multi-tab browser system allows keeping multiple media and logs open.</div>
                </div>
              </div>

              {/* Holographic blinking terminal cursor */}
              <div className="mt-8 text-[11px] font-mono text-cyan-400/80 animate-pulse">
                [ Waiting for file stream connection... ]
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Footer bar */}
      <div className="flex justify-between items-center pt-2.5 text-[9px] text-white/40 flex-shrink-0">
        <span>PEER CHANNEL: SECURE RTC DATA CHANNEL</span>
        <span>SYSTEM // BLAXDRIVE VIEWER</span>
      </div>

    </div>
  );
}
