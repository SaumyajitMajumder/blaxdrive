import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:local_auth/local_auth.dart';
import 'storage_helper.dart';
import 'webrtc_service.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  bool _isAuthenticated = false;
  bool _isAuthenticating = false;
  final LocalAuthentication _auth = LocalAuthentication();

  final WebRtcService _webRtcService = WebRtcService();
  bool _isSharing = false;
  String _localOffer = "";
  final List<String> _logs = [];
  String _connState = "Disconnected";
  
  double _transferProgress = 0.0;
  String _transferDetails = "";

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _setupWebRtcCallbacks();
    _initForegroundTask();
    _checkAutoConnect();
    _authenticate();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      setState(() {
        _isAuthenticated = false;
      });
    } else if (state == AppLifecycleState.resumed) {
      if (!_isAuthenticated && !_isAuthenticating) {
        _authenticate();
      }
    }
  }

  Future<void> _authenticate() async {
    if (_isAuthenticating) return;
    setState(() {
      _isAuthenticating = true;
    });

    try {
      final bool canAuthenticateWithBiometrics = await _auth.canCheckBiometrics;
      final bool canAuthenticate = canAuthenticateWithBiometrics || await _auth.isDeviceSupported();

      if (!canAuthenticate) {
        _addLog("Device lock/biometrics not set up or supported. Bypassing lock.");
        setState(() {
          _isAuthenticated = true;
        });
        return;
      }

      final bool didAuthenticate = await _auth.authenticate(
        localizedReason: 'Authenticate to access BlaxDrive storage client',
        options: const AuthenticationOptions(
          biometricOnly: false,
          stickyAuth: true,
          useErrorDialogs: true,
        ),
      );

      setState(() {
        _isAuthenticated = didAuthenticate;
      });
    } catch (e) {
      _addLog("Authentication error: $e");
      setState(() {
        _isAuthenticated = false;
      });
    } finally {
      setState(() {
        _isAuthenticating = false;
      });
    }
  }

  Future<void> _checkAutoConnect() async {
    // Check if auto-reconnect credentials exist
    try {
      final hasSaved = await _webRtcService.tryAutoConnect();
      if (hasSaved) {
        _addLog("Attempting auto-reconnect using saved credentials...");
        if (!await FlutterForegroundTask.isRunningService) {
          await FlutterForegroundTask.startService(
            notificationTitle: 'BlaxDrive Active',
            notificationText: 'Auto-reconnecting to last saved session...',
            callback: startCallback,
          );
        }
        setState(() {
          _isSharing = true;
          _localOffer = _webRtcService.localOfferBase64;
        });
      }
    } catch (e) {
      _addLog("Auto-reconnect check failed: $e");
    }
  }

  void _setupWebRtcCallbacks() {
    _webRtcService.onStatusMessage = (msg) {
      setState(() {
        _logs.add("[${DateTime.now().toIso8601String().substring(11, 19)}] $msg");
        if (_logs.length > 50) _logs.removeAt(0);
      });
    };

    _webRtcService.onConnectionStateChange = (state) {
      setState(() {
        _connState = state;
        if (state == "RTCPeerConnectionStateConnected" || state == "connected") {
          _updateForegroundNotification("Connected to Peer");
        } else {
          _updateForegroundNotification("Waiting for connection...");
        }
      });
    };

    _webRtcService.onTransferProgress = (progress, details) {
      setState(() {
        _transferProgress = progress / 100.0;
        _transferDetails = details;
      });
    };
  }

  void _initForegroundTask() {
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'blaxdrive_service',
        channelName: 'BlaxDrive Service',
        channelDescription: 'Keeps P2P storage connection alive.',
        channelImportance: NotificationChannelImportance.LOW,
        priority: NotificationPriority.LOW,
      ),
      iosNotificationOptions: const IOSNotificationOptions(),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.nothing(),
        autoRunOnBoot: false,
        allowWakeLock: true,
        allowWifiLock: true,
      ),
    );
  }

  Future<void> _updateForegroundNotification(String text) async {
    if (await FlutterForegroundTask.isRunningService) {
      FlutterForegroundTask.updateService(
        notificationTitle: "BlaxDrive Active",
        notificationText: text,
      );
    }
  }

  Future<void> _startSharing() async {
    // 1. Request permissions
    final storageOk = await StorageHelper.requestManageStoragePermission();
    if (!storageOk) {
      _addLog("Storage permission denied. Cannot share files.");
      return;
    }

    // 2. Start foreground service
    try {
      if (!await FlutterForegroundTask.isRunningService) {
        await FlutterForegroundTask.startService(
          notificationTitle: 'BlaxDrive Active',
          notificationText: 'Waiting for peer connection...',
          callback: startCallback,
        );
      }
    } catch (e) {
      _addLog("Foreground service error: $e");
    }

    // 3. Generate local offer and show PIN immediately
    final pin = _webRtcService.generateRandomPin();
    setState(() {
      _isSharing = true;
      _localOffer = pin;
    });

    try {
      _webRtcService.generateOffer(pin).catchError((e) {
        _addLog("Failed to start WebRTC offer: $e");
        _stopSharing();
      });
    } catch (e) {
      _addLog("Failed to start WebRTC offer: $e");
      _stopSharing();
    }
  }

  Future<void> _stopSharing() async {
    await _webRtcService.clearSavedConnection();
    _webRtcService.initializeConnection(); // acts as clean reset
    try {
      if (await FlutterForegroundTask.isRunningService) {
        await FlutterForegroundTask.stopService();
      }
    } catch (_) {}

    setState(() {
      _isSharing = false;
      _localOffer = "";
      _transferProgress = 0.0;
      _transferDetails = "";
    });
  }

  void _addLog(String msg) {
    setState(() {
      _logs.add("[${DateTime.now().toIso8601String().substring(11, 19)}] $msg");
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        title: const Text(
          "BlaxDrive",
          style: TextStyle(
            color: Colors.white,
            fontFamily: 'monospace',
            fontWeight: FontWeight.bold,
          ),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1.0),
          child: Container(
            color: Colors.white,
            height: 1.0,
          ),
        ),
      ),
      body: SafeArea(
        child: Stack(
          children: [
            _isAuthenticated ? _buildMainView() : _buildLockedView(),
            Positioned(
              bottom: 4.0,
              right: 8.0,
              child: const Text(
                "...by Saumyajit",
                style: TextStyle(
                  color: Colors.white24,
                  fontSize: 10.0,
                  fontFamily: 'monospace',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLockedView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(
              Icons.lock_outline,
              color: Colors.white70,
              size: 64.0,
            ),
            const SizedBox(height: 24.0),
            const Text(
              "BLAXDRIVE LOCKED",
              style: TextStyle(
                color: Colors.white,
                fontFamily: 'monospace',
                fontSize: 18.0,
                fontWeight: FontWeight.bold,
                letterSpacing: 2.0,
              ),
            ),
            const SizedBox(height: 8.0),
            const Text(
              "Authentication required to access local files",
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white54,
                fontFamily: 'monospace',
                fontSize: 12.0,
              ),
            ),
            const SizedBox(height: 36.0),
            TextButton(
              style: TextButton.styleFrom(
                side: const BorderSide(color: Colors.white),
                padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 12.0),
              ),
              onPressed: _authenticate,
              child: Text(
                _isAuthenticating ? "[ Authenticating... ]" : "[ Tap to Unlock ]",
                style: const TextStyle(
                  color: Colors.white,
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMainView() {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Row containing actions
          Row(
            children: [
              Expanded(
                child: TextButton(
                  style: TextButton.styleFrom(
                    side: const BorderSide(color: Colors.white),
                    backgroundColor: _isSharing ? const Color.fromRGBO(255, 0, 0, 0.1) : Colors.black,
                  ),
                  onPressed: _isSharing ? _stopSharing : _startSharing,
                  child: Text(
                    _isSharing ? "[ Stop Sharing ]" : "[ Start Sharing ]",
                    style: const TextStyle(
                      color: Colors.white,
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12.0),

          // Connection status representation
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                "Status:",
                style: TextStyle(color: Colors.white, fontFamily: 'monospace'),
              ),
              Text(
                _connState,
                style: TextStyle(
                  color: _connState.toLowerCase().contains("connected")
                      ? Colors.white
                      : Colors.white70,
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12.0),

          // Transfer progress bar
          if (_transferProgress > 0.0) ...[
            Text(
              _transferDetails,
              style: const TextStyle(color: Colors.white, fontFamily: 'monospace', fontSize: 12.0),
            ),
            const SizedBox(height: 4.0),
            LinearProgressIndicator(
              value: _transferProgress,
              backgroundColor: Colors.white24,
              valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
            ),
            const SizedBox(height: 12.0),
          ],

          // Sharing section
          if (_isSharing && _localOffer.isNotEmpty) ...[
            Expanded(
              child: ListView(
                children: [
                  const SizedBox(height: 30.0),
                  const Center(
                    child: Text(
                      "BLAXDRIVE P2P CONNECT PIN",
                      style: TextStyle(
                        color: Colors.white70,
                        fontFamily: 'monospace',
                        fontSize: 14.0,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  const SizedBox(height: 16.0),
                  Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 12.0),
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.white, width: 2.0),
                        color: const Color.fromRGBO(255, 255, 255, 0.05),
                      ),
                      child: Text(
                        _localOffer,
                        style: const TextStyle(
                          color: Colors.white,
                          fontFamily: 'monospace',
                          fontSize: 36.0,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 6.0,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16.0),
                  const Center(
                    child: Text(
                      "Enter this 6-digit code in your desktop client",
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white54,
                        fontFamily: 'monospace',
                        fontSize: 12.0,
                      ),
                    ),
                  ),
                  const SizedBox(height: 24.0),
                  Center(
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.0,
                            valueColor: AlwaysStoppedAnimation<Color>(Colors.white70),
                          ),
                        ),
                        const SizedBox(width: 10.0),
                        Text(
                          _connState.toLowerCase().contains("connected") 
                            ? "Connected!" 
                            : "Waiting for desktop connection...",
                          style: const TextStyle(
                            color: Colors.white70,
                            fontFamily: 'monospace',
                            fontSize: 12.0,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ] else ...[
            const Spacer(),
            const Center(
              child: Text(
                "Tap Start Sharing to initialize P2P.",
                style: TextStyle(color: Colors.white60, fontFamily: 'monospace'),
              ),
            ),
            const Spacer(),
          ],

          // Terminal console logs at the bottom
          const Divider(color: Colors.white, height: 24.0),
          const Text(
            "System Logs:",
            style: TextStyle(color: Colors.white, fontFamily: 'monospace', fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8.0),
          Expanded(
            flex: _isSharing ? 1 : 2,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8.0),
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white24),
              ),
              child: ListView.builder(
                itemCount: _logs.length,
                itemBuilder: (context, index) {
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 4.0),
                    child: Text(
                      _logs[index],
                      style: const TextStyle(
                        color: Colors.white70,
                        fontFamily: 'monospace',
                        fontSize: 10.0,
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// The callback function must be a top-level or static function.
@pragma('vm:entry-point')
void startCallback() {
  FlutterForegroundTask.setTaskHandler(EmptyTaskHandler());
}

class EmptyTaskHandler extends TaskHandler {
  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {}

  @override
  void onRepeatEvent(DateTime timestamp) {}

  @override
  Future<void> onDestroy(DateTime timestamp) async {}
}
