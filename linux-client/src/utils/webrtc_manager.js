// WebRTC P2P Client Connection Manager

// SDP compression using native GZIP stream and Base64 encoding
export async function compressSdp(sdp, type) {
  const jsonStr = JSON.stringify({ sdp, type });
  const stream = new Blob([jsonStr]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
  const response = new Response(compressedStream);
  const blob = await response.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result.split(',')[1];
      resolve(base64data);
    };
    reader.readAsDataURL(blob);
  });
}

export async function decompressSdp(base64Str) {
  const binaryString = atob(base64Str.trim());
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const stream = new Blob([bytes]).stream();
  const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(decompressedStream).text();
  return JSON.parse(text);
}

export class WebRtcManager {
  constructor() {
    this.peerConnection = null;
    this.dataChannel = null;
    this.activeDownloads = {};
    
    // Callbacks to UI
    this.onStatus = () => {};
    this.onConnectionState = () => {};
    this.onTreeReceived = () => {};
    this.onTransferProgress = () => {}; // (percent, details)
  }

  async publishToNtfy(topic, message) {
    try {
      const response = await fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        body: message
      });
      this.log(`Published to ntfy: ${topic}, status: ${response.status}`);
    } catch (e) {
      this.log(`Failed to publish to ntfy: ${e}`);
    }
  }

  async fetchFromNtfy(topic) {
    try {
      const response = await fetch(`https://ntfy.sh/${topic}/raw?poll=1`);
      if (response.ok) {
        const text = await response.text();
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length > 0) {
          return lines[lines.length - 1];
        }
      }
    } catch (e) {
      this.log(`Error fetching from ntfy: ${e}`);
    }
    return null;
  }

  async connectWithPin(pin) {
    this.log(`Connecting with PIN: ${pin}...`);
    try {
      let offerBase64 = null;
      for (let attempt = 1; attempt <= 10; attempt++) {
        this.log(`Fetching offer from ntfy (attempt ${attempt}/10)...`);
        offerBase64 = await this.fetchFromNtfy(`blaxdrive_offer_${pin}`);
        if (offerBase64) {
          break;
        }
        // Wait 1 second before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (!offerBase64) {
        throw new Error("No active session found for this PIN code. Please ensure 'Start Sharing' is active on your phone and try again.");
      }

      this.log("Offer found. Setting remote description and generating answer...");
      const answerBase64 = await this.applyOfferAndGenerateAnswer(offerBase64);

      this.log("Publishing answer back to phone...");
      await this.publishToNtfy(`blaxdrive_answer_${pin}`, answerBase64);
      
      this.log("Answer published. Establishing direct connection...");
    } catch (e) {
      this.log(`PIN connection failed: ${e.message}`);
      throw e;
    }
  }

  async initializeConnection() {
    this.cleanup();
    this.log("Initializing peer connection...");

    // Generate dynamic TURN credentials using openrelayproject secret-key auth
    let turnUsername = "";
    let turnCredential = "";
    try {
      const secret = "openrelayprojectsecret";
      const unixTime = Math.floor(Date.now() / 1000) + 24 * 3600; // 24 hours validity
      turnUsername = `${unixTime}:blaxdrive`;
      
      const encoder = new TextEncoder();
      const secretBuffer = encoder.encode(secret);
      const usernameBuffer = encoder.encode(turnUsername);
      
      const cryptoKey = await window.crypto.subtle.importKey(
        "raw",
        secretBuffer,
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"]
      );
      
      const signatureBuffer = await window.crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        usernameBuffer
      );
      
      const signatureBytes = new Uint8Array(signatureBuffer);
      let binaryString = "";
      for (let i = 0; i < signatureBytes.byteLength; i++) {
        binaryString += String.fromCharCode(signatureBytes[i]);
      }
      turnCredential = window.btoa(binaryString);
    } catch (e) {
      this.log(`Failed to generate dynamic TURN credentials: ${e.message}`);
    }

    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: turnUsername,
          credential: turnCredential
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: turnUsername,
          credential: turnCredential
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: turnUsername,
          credential: turnCredential
        }
      ]
    };

    this.peerConnection = new RTCPeerConnection(configuration);

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      this.log(`Connection state changed: ${state}`);
      this.onConnectionState(state);
    };

    // Handle remote data channel
    this.peerConnection.ondatachannel = (event) => {
      this.log("Received remote data channel");
      this.setupDataChannel(event.channel);
    };
  }

  setupDataChannel(channel) {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';

    this.dataChannel.onopen = () => {
      this.log("Data channel opened. Requesting storage tree...");
      this.requestTree();
    };

    this.dataChannel.onclose = () => {
      this.log("Data channel closed.");
      this.onConnectionState("disconnected");
    };

    this.dataChannel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        this.handleTextMessage(event.data);
      } else {
        this.handleBinaryMessage(event.data);
      }
    };
  }

  // Create Local Answer SDP
  async applyOfferAndGenerateAnswer(base64Offer) {
    if (!this.peerConnection) {
      await this.initializeConnection();
    }

    this.log("Parsing offer and setting remote description...");
    const decoded = await decompressSdp(base64Offer);
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription({
      type: decoded.type,
      sdp: decoded.sdp
    }));

    this.log("Creating WebRTC Answer...");
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    // Wait for ICE gathering to complete (trickle-free)
    if (this.peerConnection.iceGatheringState !== 'complete') {
      this.log("Gathering ICE candidates...");
      await new Promise((resolve) => {
        const checkState = () => {
          if (this.peerConnection.iceGatheringState === 'complete') {
            this.peerConnection.removeEventListener('icecandidate', checkIce);
            resolve();
          }
        };
        const checkIce = (e) => {
          if (e.candidate === null) {
            this.peerConnection.removeEventListener('icecandidate', checkIce);
            resolve();
          }
        };
        this.peerConnection.addEventListener('icecandidate', checkIce);
        // Fallback checks
        const timer = setInterval(() => {
          if (this.peerConnection.iceGatheringState === 'complete') {
            clearInterval(timer);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(timer);
          resolve();
        }, 8000); // Max 8s wait
      });
    }

    const localDesc = this.peerConnection.localDescription;
    const base64Answer = await compressSdp(localDesc.sdp, localDesc.type);
    
    // Save to localStorage for auto-reconnection
    localStorage.setItem('saved_offer', base64Offer);
    localStorage.setItem('saved_answer', base64Answer);
    
    this.log("Answer generated and saved successfully!");
    return base64Answer;
  }

  // Request storage tree from Android
  requestTree() {
    this.sendTextMessage({ type: 'request_tree' });
  }

  // Request file download from Android
  downloadFile(path) {
    this.log(`Requesting file download: ${path.split('/').pop()}`);
    this.sendTextMessage({ type: 'download_file', path });
  }

  // Delete file/folder on Android
  deletePath(path) {
    this.log(`Requesting deletion: ${path}`);
    this.sendTextMessage({ type: 'delete', path });
  }

  // Handle incoming JSON control messages
  handleTextMessage(text) {
    try {
      const msg = JSON.parse(text);
      switch (msg.type) {
        case 'tree':
          this.log("Directory tree updated.");
          this.onTreeReceived(msg.data);
          break;

        case 'download_start':
          const { fileId, name, size, totalChunks } = msg;
          this.log(`Downloading: ${name} (${(size / (1024 * 1024)).toFixed(2)} MB, ${totalChunks} chunks)`);
          this.activeDownloads[fileId] = {
            name,
            size,
            totalChunks,
            receivedCount: 0,
            chunks: new Array(totalChunks)
          };
          this.onTransferProgress(0, `Receiving ${name}: 0%`);
          break;

        case 'error':
          this.log(`Error from phone: ${msg.message}`);
          break;

        default:
          this.log(`Unknown text message type: ${msg.type}`);
      }
    } catch (e) {
      this.log(`Error parsing text message: ${e}`);
    }
  }

  // Handle incoming raw binary packets (Phone -> PC download)
  handleBinaryMessage(buffer) {
    if (buffer.byteLength < 13) {
      this.log("Received invalid binary packet (too short)");
      return;
    }

    const view = new DataView(buffer);
    const packetType = view.getUint8(0);

    // Type 2 is Download (Phone to PC)
    if (packetType !== 2) {
      this.log(`Received binary packet with invalid type: ${packetType}`);
      return;
    }

    const fileId = view.getUint32(1, false);
    const chunkIndex = view.getUint32(5, false);
    const totalChunks = view.getUint32(9, false);
    const payload = new Uint8Array(buffer, 13);

    const active = this.activeDownloads[fileId];
    if (!active) {
      this.log(`Received binary chunk for inactive download ID: ${fileId}`);
      return;
    }

    active.chunks[chunkIndex] = payload;
    active.receivedCount++;

    const percent = Math.round((active.receivedCount / active.totalChunks) * 100);
    this.onTransferProgress(percent, `Receiving ${active.name}: ${percent}%`);

    if (active.receivedCount === active.totalChunks) {
      this.log(`Assembly complete. Downloading ${active.name} in browser...`);
      this.onTransferProgress(100, `Download complete: ${active.name}`);

      const blob = new Blob(active.chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = active.name;
      a.click();
      URL.revokeObjectURL(url);

      delete this.activeDownloads[fileId];
    }
  }

  // Slice and upload file to phone (PC -> Phone upload)
  async uploadFile(file, destinationDirectoryPath) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      this.log("Cannot upload file: Data channel not open.");
      return;
    }

    const fileName = file.name;
    const destPath = `${destinationDirectoryPath}/${fileName}`;
    const fileSize = file.size;
    const chunkSize = 64 * 1024; // 64KB
    const totalChunks = Math.ceil(fileSize / chunkSize);
    const fileId = Math.floor(Math.random() * 0xFFFFFFFF);

    this.log(`Starting upload: ${fileName} (${(fileSize / (1024 * 1024)).toFixed(2)} MB, ${totalChunks} chunks)`);

    // Notify Android to open the file handle
    this.sendTextMessage({
      type: 'upload_start',
      fileId,
      path: destPath,
      size: fileSize,
      totalChunks
    });

    this.onTransferProgress(0, `Uploading ${fileName}: 0%`);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
        this.log("Upload cancelled: Connection closed.");
        break;
      }

      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, fileSize);
      const fileSlice = file.slice(start, end);
      const chunkData = new Uint8Array(await fileSlice.arrayBuffer());

      // Frame the packet with our 13-byte header
      const packet = new Uint8Array(13 + chunkData.byteLength);
      const view = new DataView(packet.buffer);
      view.setUint8(0, 1); // Type 1 = Upload (PC -> Phone)
      view.setUint32(1, fileId, false);
      view.setUint32(5, chunkIndex, false);
      view.setUint32(9, totalChunks, false);
      packet.set(chunkData, 13);

      this.dataChannel.send(packet);

      const percent = Math.round(((chunkIndex + 1) / totalChunks) * 100);
      this.onTransferProgress(percent, `Uploading ${fileName}: ${percent}%`);

      // Backpressure Queue check
      while (this.dataChannel && this.dataChannel.bufferedAmount > 1024 * 1024) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }

    this.log(`Upload transmission complete for: ${fileName}`);
  }

  createFolder(parentPath, folderName) {
    const path = `${parentPath}/${folderName}`;
    this.log(`Creating folder: ${path}`);
    this.sendTextMessage({ type: 'create_folder', path });
  }

  createFile(parentPath, fileName, content) {
    const path = `${parentPath}/${fileName}`;
    this.log(`Creating file: ${path}`);
    this.sendTextMessage({ type: 'create_file', path, content });
  }

  sendTextMessage(obj) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(obj));
    }
  }

  log(msg) {
    console.log(`[WebRtcManager] ${msg}`);
    this.onStatus(msg);
  }

  tryAutoConnect() {
    const offer = localStorage.getItem('saved_offer');
    const answer = localStorage.getItem('saved_answer');
    if (offer && answer) {
      this.log("Found saved credentials. Attempting auto-reconnect...");
      return this.initializeConnection().then(() => {
        return decompressSdp(offer);
      }).then((decodedOffer) => {
        return this.peerConnection.setRemoteDescription(new RTCSessionDescription({
          type: decodedOffer.type,
          sdp: decodedOffer.sdp
        }));
      }).then(() => {
        return decompressSdp(answer);
      }).then((decodedAnswer) => {
        return this.peerConnection.setLocalDescription(new RTCSessionDescription({
          type: decodedAnswer.type,
          sdp: decodedAnswer.sdp
        }));
      }).then(() => {
        this.log("Auto-reconnection initiated using persisted session.");
        return true;
      }).catch((e) => {
        this.log(`Auto-reconnect failed: ${e}`);
        this.clearSavedConnection();
        return false;
      });
    }
    return Promise.resolve(false);
  }

  clearSavedConnection() {
    localStorage.removeItem('saved_offer');
    localStorage.removeItem('saved_answer');
    this.log("Cleared persisted connection credentials.");
  }

  cleanup() {
    this.activeDownloads = {};
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (_) {}
    }
    this.peerConnection = null;
    this.dataChannel = null;
    this.onConnectionState("disconnected");
  }
}
