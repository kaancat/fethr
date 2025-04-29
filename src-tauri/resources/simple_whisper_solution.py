#!/usr/bin/env python3
"""
Simple Whisper Solution for Fethr Application

This script provides a simple, reliable way to download and use Whisper for transcription.
It handles downloading the Whisper model, transcribing audio, and returning the results.

Usage:
  python simple_whisper_solution.py download
  python simple_whisper_solution.py transcribe <audio_file_path>
"""

import os
import sys
import json
import argparse
import subprocess
import urllib.request
from pathlib import Path

# Ensure tqdm is installed
try:
    from tqdm import tqdm
except ImportError:
    print("Installing tqdm package...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "tqdm"])
        from tqdm import tqdm
    except Exception as e:
        print(f"Error installing tqdm package: {e}")
        # Fallback implementation if tqdm can't be installed
        class tqdm:
            def __init__(self, **kwargs):
                self.total = kwargs.get('total', 100)
                self.n = 0
                self.unit = kwargs.get('unit', '')
                self.desc = kwargs.get('desc', '')
                self.ncols = kwargs.get('ncols', 80)
                print(f"{self.desc} started...")
            
            def update(self, b):
                self.n += b
                progress = int(self.n / self.total * 100) if self.total else 0
                print(f"\r{self.desc}: {progress}% completed", end='', flush=True)
            
            def close(self):
                print("\nDownload completed!")
            
            def __enter__(self):
                return self
            
            def __exit__(self, *args):
                self.close()

# Configuration
MODEL_SIZE = "tiny"  # Options: tiny, base, small, medium, large
MODEL_LANG = "en"    # Language code (en for English)
APP_DATA_DIR = os.path.expanduser("~/.fethr")
MODELS_DIR = os.path.join(APP_DATA_DIR, "models")
# THIS IS THE CORRECT URL FORMAT - DO NOT CHANGE IT
WHISPER_MODEL_URL = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{MODEL_SIZE}.{MODEL_LANG}.bin"
WHISPER_MODEL_PATH = os.path.join(MODELS_DIR, f"ggml-{MODEL_SIZE}.{MODEL_LANG}.bin")

# Create necessary directories
os.makedirs(MODELS_DIR, exist_ok=True)

class DownloadProgressBar(tqdm):
    def update_to(self, b=1, bsize=1, tsize=None):
        if tsize is not None:
            self.total = tsize
        self.update(b * bsize - self.n)

def download_model():
    """Download the Whisper model if it doesn't exist"""
    if os.path.exists(WHISPER_MODEL_PATH):
        print(f"Model already exists at: {WHISPER_MODEL_PATH}")
        return True
    
    print(f"Downloading Whisper model ({MODEL_SIZE}.{MODEL_LANG}) from Hugging Face...")
    try:
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(WHISPER_MODEL_PATH), exist_ok=True)
        
        # THIS IS THE CORRECT URL FORMAT - DO NOT CHANGE IT
        model_url = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{MODEL_SIZE}.{MODEL_LANG}.bin"
        
        print(f"Downloading from: {model_url}")
        print(f"Saving to: {WHISPER_MODEL_PATH}")
        
        with DownloadProgressBar(unit='B', unit_scale=True, miniters=1, desc="Downloading") as t:
            urllib.request.urlretrieve(
                model_url,
                WHISPER_MODEL_PATH,
                reporthook=t.update_to
            )
        print(f"Model downloaded to: {WHISPER_MODEL_PATH}")
        return True
    except Exception as e:
        print(f"Error downloading model: {e}")
        # Add more detailed error reporting for network issues
        if "HTTP Error 404" in str(e):
            print(f"Model file not found at URL: {model_url}")
            print("The model may have been moved or renamed. Please check the repository for the latest model URLs.")
        return False

def verify_model_download():
    """Verify that the model can be downloaded correctly"""
    try:
        # Test the URL directly
        model_url = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{MODEL_SIZE}.{MODEL_LANG}.bin"
        
        # Just check if the URL is accessible
        req = urllib.request.Request(model_url, method="HEAD")
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status == 200:
                content_length = response.headers.get("Content-Length")
                print(f"Model URL is valid. File size: {int(content_length) / (1024*1024):.2f} MB")
                return True
            else:
                print(f"Model URL returned status code: {response.status}")
                return False
    except Exception as e:
        print(f"Error verifying model URL: {e}")
        return False

def install_whisper():
    """Install the whisper package if not already installed"""
    try:
        import whisper
        print("Whisper package is already installed")
        return True
    except ImportError:
        print("Installing whisper package...")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "openai-whisper"])
            print("Whisper package installed successfully")
            return True
        except Exception as e:
            print(f"Error installing whisper package: {e}")
            return False

def transcribe_audio(audio_path):
    """Transcribe audio using Whisper"""
    if not os.path.exists(audio_path):
        return json.dumps({"error": f"Audio file not found: {audio_path}"})
    
    # Ensure model is downloaded
    if not os.path.exists(WHISPER_MODEL_PATH):
        if not download_model():
            return json.dumps({"error": "Failed to download Whisper model"})
    
    # Ensure whisper is installed
    if not install_whisper():
        return json.dumps({"error": "Failed to install Whisper package"})
    
    # Import whisper here after ensuring it's installed
    import whisper
    
    try:
        # Load model
        print(f"Loading Whisper model: {MODEL_SIZE}")
        model = whisper.load_model(MODEL_SIZE)
        
        # Transcribe audio
        print(f"Transcribing audio: {audio_path}")
        result = model.transcribe(audio_path)
        
        # Return result as JSON
        return json.dumps({
            "text": result["text"],
            "language": result.get("language", "en"),
            "segments": result.get("segments", [])
        })
    except Exception as e:
        return json.dumps({"error": f"Transcription error: {e}"})

def main():
    parser = argparse.ArgumentParser(description="Simple Whisper Solution")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # Download command
    download_parser = subparsers.add_parser("download", help="Download Whisper model")
    download_parser.add_argument("--verbose", action="store_true", help="Enable verbose output")
    download_parser.add_argument("--verify", action="store_true", help="Verify model URL before downloading")
    
    # Transcribe command
    transcribe_parser = subparsers.add_parser("transcribe", help="Transcribe audio file")
    transcribe_parser.add_argument("audio_path", help="Path to audio file")
    
    args = parser.parse_args()
    
    if args.command == "download":
        # If verify flag is set, verify the model URL first
        if hasattr(args, 'verify') and args.verify:
            if not verify_model_download():
                print("Model URL verification failed. Aborting download.")
                sys.exit(1)
        success = download_model()
        sys.exit(0 if success else 1)
    elif args.command == "transcribe":
        result = transcribe_audio(args.audio_path)
        print(result)
        sys.exit(0)
    else:
        parser.print_help()
        sys.exit(1)

if __name__ == "__main__":
    main() 