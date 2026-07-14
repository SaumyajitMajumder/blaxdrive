import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:crypto/crypto.dart';
import 'storage_helper.dart';

class WebRtcService {
  RTCPeerConnection? _peerConnection;
  RTCDataChannel? _dataChannel;
  
  // Callback for UI updates
  Function(String)? onStatusMessage;
  Function(String)? onConnectionStateChange;
  Function(double, String)? onTransferProgress; // percentage, details
  Function()? onTreeUpdate;

  bool isConnected = false;
  String connectionState = "Disconnected";
  String localOfferBase64 = "";
  String pinCode = "";
  Timer? _answerPollTimer;

  final Map<int, RandomAccessFile> _activeUploads = {};
  final Map<int, String> _activeUploadPaths = {};

  // Initialize WebRTC connection
  Future<void> initializeConnection() async {
    _cleanup();
    _log("Initializing peer connection...");

    final secret = "openrelayprojectsecret";
    final unixTime = (DateTime.now().millisecondsSinceEpoch ~/ 1000) + 24 * 3600; // 24 hours validity
    final username = "$unixTime:blaxdrive";
    final hmac = Hmac(sha1, utf8.encode(secret));
    final digest = hmac.convert(utf8.encode(username));
    final credential = base64.encode(digest.bytes);

    final configuration = {
      'iceServers': <Map<String, dynamic>>[],
      'sdpSemantics': 'unified-plan'
    };

    final constraints = {
      'mandatory': {},
      'optional': [
        {'DtlsSrtpKeyAgreement': true}
      ]
    };

    _peerConnection = await createPeerConnection(configuration, constraints);

    // Setup ice connection state listener
    _peerConnection!.onConnectionState = (state) {
      _log("Connection State: ${state.name}");
      connectionState = state.name;
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        isConnected = true;
      } else if (state == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected ||
                 state == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
                 state == RTCPeerConnectionState.RTCPeerConnectionStateClosed) {
        isConnected = false;
        _closeActiveUploads();
      }
      onConnectionStateChange?.call(connectionState);
    };

    _peerConnection!.onIceConnectionState = (state) {
      _log("ICE Connection State: ${state.name}");
    };

    // Create Data Channel
    final dcInit = RTCDataChannelInit()
      ..binaryType = 'binary'
      ..ordered = true;
    
    _dataChannel = await _peerConnection!.createDataChannel("blaxdrive-channel", dcInit);
    _setupDataChannel(_dataChannel!);

    // Handle incoming data channels
    _peerConnection!.onDataChannel = (channel) {
      _log("Received remote data channel");
      _setupDataChannel(channel);
    };
  }

  void _setupDataChannel(RTCDataChannel channel) {
    channel.onMessage = (RTCDataChannelMessage message) {
      if (message.isBinary) {
        _handleBinaryMessage(message.binary);
      } else {
        _handleTextMessage(message.text);
      }
    };

    channel.onDataChannelState = (state) {
      _log("Data Channel State: ${state.name}");
      if (state == RTCDataChannelState.RTCDataChannelOpen) {
        // Send initial tree automatically when connected
        sendDirectoryTree();
      }
    };
  }

  Future<String> getOrCreateUniquePin() async {
    final prefs = await SharedPreferences.getInstance();
    var pin = prefs.getString('unique_device_pin');
    if (pin == null || pin.length != 6) {
      pin = (100000 + Random().nextInt(900000)).toString();
      await prefs.setString('unique_device_pin', pin);
    }
    return pin;
  }

  // Create local offer
  Future<void> generateOffer(String pin) async {
    _answerPollTimer?.cancel();

    if (_peerConnection == null) {
      await initializeConnection();
    }

    pinCode = pin;
    _log("Using PIN Code: $pinCode");

    _log("Creating WebRTC Offer...");
    final offer = await _peerConnection!.createOffer({});
    await _peerConnection!.setLocalDescription(offer);

    // Wait for ICE candidate gathering to complete (trickle-free)
    final gatheringState = await _peerConnection!.getIceGatheringState();
    if (gatheringState != RTCIceGatheringState.RTCIceGatheringStateComplete) {
      _log("Waiting for ICE gathering to complete...");
      final completer = Completer<void>();
      
      _peerConnection!.onIceGatheringState = (state) {
        _log("ICE Gathering State: ${state.name}");
        if (state == RTCIceGatheringState.RTCIceGatheringStateComplete) {
          if (!completer.isCompleted) completer.complete();
        }
      };
      
      // Safety timeout: 10 seconds
      await completer.future.timeout(const Duration(seconds: 10), onTimeout: () {
        _log("ICE gathering timeout. Compressing partial offer.");
      });
    }

    final localDesc = await _peerConnection!.getLocalDescription();
    if (localDesc != null) {
      _log("Local SDP Offer:\n${localDesc.sdp}");
      localOfferBase64 = _compressSdp(localDesc.sdp!, localDesc.type!);
      _log("Offer generated successfully! Publishing to ntfy...");
      await _publishToNtfy('blaxdrive_offer_$pinCode', localOfferBase64);
      
      // Start polling for answer
      startPollingForAnswer((answer) async {
        await acceptAnswer(answer);
      });
    } else {
      throw Exception("Failed to get local description");
    }
  }

  Future<void> _publishToNtfy(String topic, String message) async {
    final client = HttpClient();
    try {
      final request = await client.postUrl(Uri.parse('https://ntfy.sh/$topic'));
      request.write(message);
      final response = await request.close();
      _log("Published offer to ntfy: $topic, status: ${response.statusCode}");
    } catch (e) {
      _log("Failed to publish to ntfy: $e");
    } finally {
      client.close();
    }
  }

  Future<String?> _fetchFromNtfy(String topic) async {
    final client = HttpClient();
    try {
      final request = await client.getUrl(Uri.parse('https://ntfy.sh/$topic/raw?poll=1'));
      final response = await request.close();
      if (response.statusCode == 200) {
        final body = await response.transform(utf8.decoder).join();
        final lines = body.split('\n').map((l) => l.trim()).where((l) => l.isNotEmpty).toList();
        if (lines.isNotEmpty) {
          return lines.last;
        }
      }
    } catch (e) {
      _log("Error fetching from ntfy: $e");
    } finally {
      client.close();
    }
    return null;
  }

  void startPollingForAnswer(Function(String) onAnswerReceived) {
    _answerPollTimer?.cancel();
    _answerPollTimer = Timer.periodic(const Duration(seconds: 2), (timer) async {
      if (pinCode.isEmpty || isConnected) {
        timer.cancel();
        return;
      }
      final answer = await _fetchFromNtfy('blaxdrive_answer_$pinCode');
      if (answer != null && answer.isNotEmpty) {
        timer.cancel();
        onAnswerReceived(answer);
      }
    });
  }

  // Accept remote answer
  Future<void> acceptAnswer(String base64Answer) async {
    if (_peerConnection == null) {
      throw Exception("Peer connection not initialized");
    }

    _log("Applying remote WebRTC Answer...");
    try {
      final decoded = _decompressSdp(base64Answer);
      final sdp = decoded['sdp'] as String;
      final type = decoded['type'] as String;
      _log("Remote SDP Answer:\n$sdp");
      
      final answerDesc = RTCSessionDescription(sdp, type);
      await _peerConnection!.setRemoteDescription(answerDesc);
      _log("Remote description set successfully. Establishing connection...");
      
      // Save credentials for auto-reconnect
      await saveConnection(localOfferBase64, base64Answer);
    } catch (e) {
      _log("Error applying answer: $e");
      rethrow;
    }
  }

  // Clean up resources
  void _cleanup() {
    _answerPollTimer?.cancel();
    _answerPollTimer = null;
    pinCode = "";
    _closeActiveUploads();
    _peerConnection?.close();
    _peerConnection = null;
    _dataChannel?.close();
    _dataChannel = null;
    isConnected = false;
    connectionState = "Disconnected";
    localOfferBase64 = "";
  }

  void _closeActiveUploads() {
    for (final raf in _activeUploads.values) {
      try {
        raf.closeSync();
      } catch (_) {}
    }
    _activeUploads.clear();
    _activeUploadPaths.clear();
  }

  // SDP Compression using GZIP -> Base64
  String _compressSdp(String sdp, String type) {
    final Map<String, String> data = {'sdp': sdp, 'type': type};
    final jsonStr = jsonEncode(data);
    final bytes = utf8.encode(jsonStr);
    final compressed = gzip.encode(bytes);
    return base64Encode(compressed);
  }

  Map<String, dynamic> _decompressSdp(String base64str) {
    final bytes = base64Decode(base64str.trim());
    final decompressed = gzip.decode(bytes);
    final jsonStr = utf8.decode(decompressed);
    return jsonDecode(jsonStr) as Map<String, dynamic>;
  }

  // Send directory tree
  void sendDirectoryTree() {
    if (_dataChannel == null || _dataChannel!.state != RTCDataChannelState.RTCDataChannelOpen) {
      _log("Cannot send tree: Data channel not open.");
      return;
    }

    _log("Reading and sending storage tree...");
    try {
      final tree = StorageHelper.buildDirectoryTree();
      final msg = jsonEncode({
        'type': 'tree',
        'data': tree
      });
      _dataChannel!.send(RTCDataChannelMessage(msg));
      _log("Storage tree sent!");
    } catch (e) {
      _log("Error building directory tree: $e");
      final errorMsg = jsonEncode({
        'type': 'error',
        'message': 'Failed to read directory tree: $e'
      });
      _dataChannel!.send(RTCDataChannelMessage(errorMsg));
    }
  }

  // Handle incoming JSON text messages
  void _handleTextMessage(String text) async {
    try {
      final msg = jsonDecode(text) as Map<String, dynamic>;
      final type = msg['type'] as String;

      switch (type) {
        case 'request_tree':
          sendDirectoryTree();
          break;

        case 'delete':
          final path = msg['path'] as String;
          _log("Deleting path: $path");
          try {
            final file = File(path);
            final dir = Directory(path);
            if (file.existsSync()) {
              file.deleteSync();
            } else if (dir.existsSync()) {
              dir.deleteSync(recursive: true);
            }
            sendDirectoryTree();
            onStatusMessage?.call("Deleted: ${path.split('/').last}");
          } catch (e) {
            _log("Failed to delete $path: $e");
            onStatusMessage?.call("Delete failed: $e");
          }
          break;

        case 'create_folder':
          final path = msg['path'] as String;
          _log("Creating directory: $path");
          try {
            final dir = Directory(path);
            if (!dir.existsSync()) {
              dir.createSync(recursive: true);
            }
            sendDirectoryTree();
            onStatusMessage?.call("Created folder: ${path.split('/').last}");
          } catch (e) {
            _log("Failed to create folder $path: $e");
            onStatusMessage?.call("Create folder failed: $e");
          }
          break;

        case 'create_file':
          final path = msg['path'] as String;
          final content = msg['content'] as String? ?? "";
          _log("Creating file: $path");
          try {
            final file = File(path);
            // Ensure parent dir exists
            file.parent.createSync(recursive: true);
            await file.writeAsString(content);
            sendDirectoryTree();
            onStatusMessage?.call("Created file: ${path.split('/').last}");
          } catch (e) {
            _log("Failed to create file $path: $e");
            onStatusMessage?.call("Create file failed: $e");
          }
          break;

        case 'upload_start':
          final fileId = msg['fileId'] as int;
          final path = msg['path'] as String;
          _log("Starting upload for: $path (ID: $fileId)");
          try {
            final file = File(path);
            if (file.existsSync()) {
              file.deleteSync();
            }
            // Ensure parent dir exists
            file.parent.createSync(recursive: true);
            final raf = file.openSync(mode: FileMode.write);
            _activeUploads[fileId] = raf;
            _activeUploadPaths[fileId] = path;
          } catch (e) {
            _log("Failed to start upload: $e");
            onStatusMessage?.call("Upload start failed: $e");
          }
          break;

        case 'download_file':
          final path = msg['path'] as String;
          _log("Requested download: $path");
          _sendFileToPeer(path);
          break;

        default:
          _log("Unknown text message type: $type");
      }
    } catch (e) {
      _log("Error parsing text message: $e");
    }
  }

  // Handle incoming raw binary chunks (PC -> Phone upload)
  void _handleBinaryMessage(Uint8List bytes) {
    if (bytes.length < 13) {
      _log("Received invalid binary packet (too short).");
      return;
    }

    final bd = ByteData.view(bytes.buffer);
    final packetType = bd.getUint8(0);
    
    // Type 1 is Upload (PC to Phone)
    if (packetType != 1) {
      _log("Received binary packet with invalid type: $packetType");
      return;
    }

    final fileId = bd.getUint32(1, Endian.big);
    final chunkIndex = bd.getUint32(5, Endian.big);
    final totalChunks = bd.getUint32(9, Endian.big);
    final payload = bytes.sublist(13);

    final raf = _activeUploads[fileId];
    if (raf == null) {
      _log("Received binary chunk for inactive upload ID: $fileId");
      return;
    }

    try {
      // Seek to correct chunk position
      raf.setPositionSync(chunkIndex * 65536); // 64KB chunk sizes
      raf.writeFromSync(payload);

      final progress = ((chunkIndex + 1) / totalChunks) * 100;
      final fileName = _activeUploadPaths[fileId]?.split('/').last ?? "file";
      onTransferProgress?.call(progress, "Receiving $fileName: ${progress.toStringAsFixed(1)}%");

      if (chunkIndex >= totalChunks - 1) {
        // Finished!
        raf.flushSync();
        raf.closeSync();
        _activeUploads.remove(fileId);
        _activeUploadPaths.remove(fileId);
        _log("Upload finished: $fileName");
        onTransferProgress?.call(100.0, "Upload completed: $fileName");
        sendDirectoryTree();
      }
    } catch (e) {
      _log("Error writing binary chunk: $e");
      onStatusMessage?.call("Error writing file chunk: $e");
      try {
        raf.closeSync();
      } catch (_) {}
      _activeUploads.remove(fileId);
      _activeUploadPaths.remove(fileId);
    }
  }

  // Stream/Send file to PC in chunks (Phone -> PC download)
  Future<void> _sendFileToPeer(String path) async {
    final file = File(path);
    if (!file.existsSync()) {
      _log("File not found for download: $path");
      return;
    }

    final fileName = path.split('/').last;
    final fileLength = file.lengthSync();
    const chunkSize = 64 * 1024; // 64KB
    final totalChunks = (fileLength / chunkSize).ceil();
    final fileId = DateTime.now().millisecondsSinceEpoch & 0xFFFFFFFF; // Simple 32-bit ID

    _log("Starting transmission of $fileName ($fileLength bytes, $totalChunks chunks)");

    // Inform PC that download is starting
    final initMsg = jsonEncode({
      'type': 'download_start',
      'path': path,
      'name': fileName,
      'size': fileLength,
      'totalChunks': totalChunks,
      'fileId': fileId
    });
    _dataChannel!.send(RTCDataChannelMessage(initMsg));

    var chunkIndex = 0;
    RandomAccessFile? raf;
    try {
      raf = file.openSync(mode: FileMode.read);
      while (chunkIndex < totalChunks) {
        if (_dataChannel == null || _dataChannel!.state != RTCDataChannelState.RTCDataChannelOpen) {
          _log("Transfer cancelled: Connection closed.");
          break;
        }

        // Seek and read 64KB
        raf.setPositionSync(chunkIndex * chunkSize);
        final buffer = raf.readSync(chunkSize);
        if (buffer.isEmpty) break;

        // Build binary packet
        final packet = Uint8List(13 + buffer.length);
        final bd = ByteData.view(packet.buffer);
        bd.setUint8(0, 2); // Type 2 = Download (Phone -> PC)
        bd.setUint32(1, fileId, Endian.big);
        bd.setUint32(5, chunkIndex, Endian.big);
        bd.setUint32(9, totalChunks, Endian.big);
        packet.setAll(13, buffer);

        // Send binary data
        _dataChannel!.send(RTCDataChannelMessage.fromBinary(packet));

        chunkIndex++;
        final progress = (chunkIndex / totalChunks) * 100;
        onTransferProgress?.call(progress, "Sending $fileName: ${progress.toStringAsFixed(1)}%");

        // Backpressure management: wait if buffer has over 1MB queued
        while (_dataChannel != null && (_dataChannel!.bufferedAmount ?? 0) > 1024 * 1024) {
          await Future.delayed(const Duration(milliseconds: 30));
        }
      }
      _log("Transmission completed: $fileName");
      onTransferProgress?.call(100.0, "Sent: $fileName");
    } catch (e) {
      _log("Error during download stream: $e");
      onStatusMessage?.call("Download stream error: $e");
    } finally {
      try {
        raf?.closeSync();
      } catch (_) {}
    }
  }

  Future<void> saveConnection(String offer, String answer) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('saved_offer', offer);
    await prefs.setString('saved_answer', answer);
    _log("Persisted P2P connection credentials.");
  }

  Future<void> clearSavedConnection() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('saved_offer');
    await prefs.remove('saved_answer');
    _log("Cleared persisted P2P connection credentials.");
  }

  Future<bool> tryAutoConnect() async {
    final prefs = await SharedPreferences.getInstance();
    final offer = prefs.getString('saved_offer');
    final answer = prefs.getString('saved_answer');
    if (offer != null && answer != null) {
      _log("Found saved connection credentials. Attempting auto-reconnect...");
      try {
        await initializeConnection();
        
        // Re-apply local description (offer)
        final decodedOffer = _decompressSdp(offer);
        final offerDesc = RTCSessionDescription(decodedOffer['sdp'] as String, decodedOffer['type'] as String);
        await _peerConnection!.setLocalDescription(offerDesc);
        localOfferBase64 = offer;

        // Re-apply remote description (answer)
        final decodedAnswer = _decompressSdp(answer);
        final answerDesc = RTCSessionDescription(decodedAnswer['sdp'] as String, decodedAnswer['type'] as String);
        await _peerConnection!.setRemoteDescription(answerDesc);

        _log("Auto-reconnection initiated using persisted session.");
        return true;
      } catch (e) {
        _log("Auto-reconnect failed: $e");
        await clearSavedConnection();
        return false;
      }
    }
    return false;
  }

  void _log(String msg) {
    print("[BlaxDrive WebRTC] $msg");
    onStatusMessage?.call(msg);
  }
}
