import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'home_screen.dart';
import 'auth_gate.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Initialize communication port for foreground task
  if (Platform.isAndroid) {
    FlutterForegroundTask.initCommunicationPort();
  }
  
  runApp(const BlaxDriveApp());
}

class BlaxDriveApp extends StatelessWidget {
  const BlaxDriveApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BlaxDrive',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: Colors.black,
        primaryColor: Colors.black,
        textSelectionTheme: const TextSelectionThemeData(
          cursorColor: Colors.white,
          selectionColor: Colors.white24,
          selectionHandleColor: Colors.white,
        ),
      ),
      home: const WithForegroundTask(
        child: AuthGate(
          child: HomeScreen(),
        ),
      ),
    );
  }
}
