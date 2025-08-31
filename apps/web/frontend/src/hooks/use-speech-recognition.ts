import { useState, useRef, useCallback, useEffect } from 'react';
import '../types/speech-recognition.d.ts';

interface Language {
  code: string;
  name: string;
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'en-AU', name: 'English (Australia)' },
  { code: 'en-CA', name: 'English (Canada)' },
  { code: 'vi-VN', name: 'Vietnamese' },
  { code: 'es-ES', name: 'Spanish (Spain)' },
  { code: 'es-MX', name: 'Spanish (Mexico)' },
  { code: 'es-AR', name: 'Spanish (Argentina)' },
  { code: 'es-CO', name: 'Spanish (Colombia)' },
  { code: 'fr-FR', name: 'French (France)' },
  { code: 'fr-CA', name: 'French (Canada)' },
  { code: 'fr-BE', name: 'French (Belgium)' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'zh-HK', name: 'Chinese (Hong Kong)' },
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'ko-KR', name: 'Korean' },
  { code: 'de-DE', name: 'German' },
  { code: 'de-AT', name: 'German (Austria)' },
  { code: 'de-CH', name: 'German (Switzerland)' },
  { code: 'it-IT', name: 'Italian' },
  { code: 'it-CH', name: 'Italian (Switzerland)' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { code: 'pt-PT', name: 'Portuguese (Portugal)' },
  { code: 'ru-RU', name: 'Russian' },
  { code: 'ar-SA', name: 'Arabic (Saudi Arabia)' },
  { code: 'ar-EG', name: 'Arabic (Egypt)' },
  { code: 'ar-AE', name: 'Arabic (UAE)' },
  { code: 'hi-IN', name: 'Hindi (India)' },
  { code: 'bn-IN', name: 'Bengali (India)' },
  { code: 'ta-IN', name: 'Tamil (India)' },
  { code: 'th-TH', name: 'Thai' },
  { code: 'nl-NL', name: 'Dutch' },
  { code: 'nl-BE', name: 'Dutch (Belgium)' },
  { code: 'sv-SE', name: 'Swedish' },
  { code: 'da-DK', name: 'Danish' },
  { code: 'no-NO', name: 'Norwegian' },
  { code: 'fi-FI', name: 'Finnish' },
  { code: 'pl-PL', name: 'Polish' },
  { code: 'tr-TR', name: 'Turkish' },
  { code: 'id-ID', name: 'Indonesian' },
  { code: 'ms-MY', name: 'Malay' },
  { code: 'uk-UA', name: 'Ukrainian' },
  { code: 'cs-CZ', name: 'Czech' },
  { code: 'sk-SK', name: 'Slovak' },
  { code: 'hu-HU', name: 'Hungarian' },
  { code: 'ro-RO', name: 'Romanian' },
  { code: 'bg-BG', name: 'Bulgarian' },
  { code: 'hr-HR', name: 'Croatian' },
  { code: 'sr-RS', name: 'Serbian' },
  { code: 'sl-SI', name: 'Slovenian' },
  { code: 'et-EE', name: 'Estonian' },
  { code: 'lv-LV', name: 'Latvian' },
  { code: 'lt-LT', name: 'Lithuanian' },
  { code: 'he-IL', name: 'Hebrew' },
  { code: 'fa-IR', name: 'Persian' },
  { code: 'ur-PK', name: 'Urdu' },
  { code: 'te-IN', name: 'Telugu' },
  { code: 'ml-IN', name: 'Malayalam' },
  { code: 'kn-IN', name: 'Kannada' },
  { code: 'gu-IN', name: 'Gujarati' },
  { code: 'mr-IN', name: 'Marathi' },
  { code: 'ne-NP', name: 'Nepali' },
  { code: 'si-LK', name: 'Sinhala' },
  { code: 'my-MM', name: 'Myanmar' },
  { code: 'km-KH', name: 'Khmer' },
  { code: 'lo-LA', name: 'Lao' },
  { code: 'ka-GE', name: 'Georgian' },
  { code: 'am-ET', name: 'Amharic' },
  { code: 'sw-KE', name: 'Swahili' },
  { code: 'af-ZA', name: 'Afrikaans' },
  { code: 'is-IS', name: 'Icelandic' },
  { code: 'mt-MT', name: 'Maltese' },
  { code: 'cy-GB', name: 'Welsh' },
  { code: 'ga-IE', name: 'Irish' },
  { code: 'eu-ES', name: 'Basque' },
  { code: 'ca-ES', name: 'Catalan' },
  { code: 'gl-ES', name: 'Galician' }
];

interface SpeechRecognitionOptions {
  onResult?: (transcript: string) => void;
  onError?: (error: string) => void;
  language?: string;
  continuous?: boolean;
}

interface UseSpeechRecognitionReturn {
  isListening: boolean;
  transcript: string;
  error: string | null;
  isSupported: boolean;
  selectedLanguage: string;
  detectedLanguage: string | null;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
  getCurrentDuration: () => number;
  abortRecording: () => void;
  completeRecording: () => void;
}

export const useSpeechRecognition = (options: SpeechRecognitionOptions = {}): UseSpeechRecognitionReturn => {
  const {
    onResult,
    onError,
    language = 'en-US',
    continuous = false
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState('en-US');
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const recognitionRef = useRef<any>(null);

  // Check if speech recognition is supported
  const isSupported = typeof window !== 'undefined' && 
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const startListening = useCallback(async () => {
    if (!isSupported) {
      const errorMsg = 'Speech recognition is not supported in this browser';
      setError(errorMsg);
      onError?.(errorMsg);
      return;
    }

    // Cleanup any existing recognition instance
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    setError(null);
    setTranscript('');
    setIsListening(true);
    setDetectedLanguage(null);
    setRecordingStartTime(Date.now());

    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      
      // Store the recognition instance
      recognitionRef.current = recognition;
      
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US'; // Always use English
      
      // Set detected language display name
      setDetectedLanguage('English (US)');
      
      recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }
        
        // Update transcript continuously but don't trigger onResult yet
        if (finalTranscript) {
          setTranscript(prev => prev + finalTranscript);
        }
      };
      
      recognition.onerror = (event) => {
        console.log('Speech recognition error:', event.error);
        const errorMsg = `Speech recognition error: ${event.error}`;
        setError(errorMsg);
        onError?.(errorMsg);
        setIsListening(false);
      };
      
      recognition.onend = () => {
        // Don't auto-complete, let user decide with buttons
        console.log('Recognition ended');
      };
      
      console.log('Starting speech recognition with English');
      recognition.start();
      
    } catch (err) {
      const errorMsg = 'Failed to start speech recognition';
      setError(errorMsg);
      onError?.(errorMsg);
      setIsListening(false);
    }
  }, [isSupported, onResult, onError]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setTranscript('');
    setError(null);
    setRecordingStartTime(null);
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setError(null);
  }, []);

  const getCurrentDuration = useCallback(() => {
    if (!recordingStartTime) return 0;
    return Math.floor((Date.now() - recordingStartTime) / 1000);
  }, [recordingStartTime]);

  const abortRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setTranscript('');
    setError(null);
    setRecordingStartTime(null);
  }, []);

  const completeRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setError(null);
    setRecordingStartTime(null);
    
    // Trigger onResult with accumulated transcript when user confirms
    if (transcript && onResult) {
      onResult(transcript);
    }
  }, [transcript, onResult]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isListening,
    transcript,
    error,
    isSupported,
    selectedLanguage,
    detectedLanguage,
    startListening,
    stopListening,
    resetTranscript,
    getCurrentDuration,
    abortRecording,
    completeRecording
  };
};