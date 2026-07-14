#!/bin/bash
# BlaxDrive Launcher Script
cd "$(dirname "$0")"
export NODE_ENV=production
npx electron . --no-sandbox
