import React, { useState } from 'react';

export default function FileTree({ node, depth = 0, onDownload, onDelete, onSelectDirectory, selectedDirectory }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!node) return null;

  const isDirectory = node.type === 'directory';
  const indent = ' '.repeat(depth * 4);

  const formatSize = (bytes) => {
    if (bytes === undefined || bytes === null) return '';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const nameLabel = isDirectory ? `${node.name}/` : node.name;
  const typeIndicator = isDirectory ? '[D]' : '[F]';
  const sizeLabel = isDirectory ? '' : ` (${formatSize(node.size)})`;

  const handleToggle = (e) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
    if (isDirectory) {
      onSelectDirectory(node.path);
    }
  };

  const isCurrentTarget = selectedDirectory === node.path;

  return (
    <div className="font-mono text-white select-none whitespace-pre leading-5">
      <div 
        className={`hover:bg-white hover:text-black px-2 py-0.5 flex items-center justify-between cursor-pointer ${
          isCurrentTarget ? 'border border-dashed border-white' : ''
        }`}
        onClick={handleToggle}
      >
        <span>
          {indent}{typeIndicator} {nameLabel}{sizeLabel}
        </span>
        
        <span className="ml-4" onClick={(e) => e.stopPropagation()}>
          {isDirectory ? (
            <>
              <button 
                onClick={handleToggle} 
                className="hover:bg-white hover:text-black px-1 focus:outline-none mr-2 border border-transparent hover:border-black"
              >
                {isOpen ? '[Close]' : '[Open]'}
              </button>
              <button 
                onClick={() => {
                  if (confirm(`Delete folder ${node.name} and all its contents?`)) {
                    onDelete(node.path);
                  }
                }} 
                className="hover:bg-white hover:text-black px-1 focus:outline-none border border-transparent hover:border-black"
              >
                [Delete]
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={() => onDownload(node.path)} 
                className="hover:bg-white hover:text-black px-1 focus:outline-none mr-2 border border-transparent hover:border-black"
              >
                [Download]
              </button>
              <button 
                onClick={() => {
                  if (confirm(`Delete file ${node.name}?`)) {
                    onDelete(node.path);
                  }
                }} 
                className="hover:bg-white hover:text-black px-1 focus:outline-none border border-transparent hover:border-black"
              >
                [Delete]
              </button>
            </>
          )}
        </span>
      </div>

      {isDirectory && isOpen && node.children && node.children.length > 0 && (
        <div>
          {node.children.map((child, idx) => (
            <FileTree 
              key={child.path || idx} 
              node={child} 
              depth={depth + 1} 
              onDownload={onDownload} 
              onDelete={onDelete}
              onSelectDirectory={onSelectDirectory}
              selectedDirectory={selectedDirectory}
            />
          ))}
        </div>
      )}
    </div>
  );
}
