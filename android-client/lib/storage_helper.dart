import 'dart:io';
import 'package:permission_handler/permission_handler.dart';

class StorageHelper {
  static const String rootPath = '/storage/emulated/0';

  // Request Manage External Storage permission
  static Future<bool> requestManageStoragePermission() async {
    if (Platform.isAndroid) {
      var status = await Permission.manageExternalStorage.status;
      if (!status.isGranted) {
        status = await Permission.manageExternalStorage.request();
      }
      return status.isGranted;
    }
    return true; // Non-Android fallback
  }

  // Request Camera permission
  static Future<bool> requestCameraPermission() async {
    var status = await Permission.camera.status;
    if (!status.isGranted) {
      status = await Permission.camera.request();
    }
    return status.isGranted;
  }

  // Build JSON tree recursively starting from rootPath
  static Map<String, dynamic> buildDirectoryTree() {
    final dir = Directory(rootPath);
    if (!dir.existsSync()) {
      return {
        'name': '0',
        'type': 'directory',
        'path': rootPath,
        'children': []
      };
    }
    return _traverse(dir);
  }

  static Map<String, dynamic> _traverse(Directory dir) {
    final String name = dir.path.split('/').last;
    final List<Map<String, dynamic>> children = [];

    try {
      final List<FileSystemEntity> entities = dir.listSync(followLinks: false);
      for (final entity in entities) {
        final entityName = entity.path.split('/').last;
        // Skip hidden files/directories and Android folder
        if (entityName.startsWith('.') || entityName.toLowerCase() == 'android') {
          continue;
        }

        if (entity is Directory) {
          children.add(_traverse(entity));
        } else if (entity is File) {
          int size = 0;
          try {
            size = entity.lengthSync();
          } catch (_) {}
          children.add({
            'name': entityName,
            'type': 'file',
            'size': size,
            'path': entity.path,
          });
        }
      }
    } catch (e) {
      // Return empty children list for directories that fail to list (permission, etc.)
    }

    // Sort children: directories first, then files alphabetically
    children.sort((a, b) {
      if (a['type'] != b['type']) {
        return a['type'] == 'directory' ? -1 : 1;
      }
      return (a['name'] as String).toLowerCase().compareTo((b['name'] as String).toLowerCase());
    });

    return {
      'name': name.isEmpty ? '0' : name,
      'type': 'directory',
      'path': dir.path,
      'children': children,
    };
  }
}
