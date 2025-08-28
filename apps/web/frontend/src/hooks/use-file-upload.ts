import { useState } from 'react';
import { api } from '@/services/api';
import { useToast } from './use-toast';
import type { FileUploadState, FileUploadHook, ProcessedFileData } from '@/types/analytics';

export function useFileUpload(): FileUploadHook {
  const { toast } = useToast();
  
  const [uploadState, setUploadState] = useState<FileUploadState>({
    isUploading: false,
    uploadError: null,
    uploadSuccess: false,
    processedData: null,
  });

  const resetUploadState = () => {
    setUploadState({
      isUploading: false,
      uploadError: null,
      uploadSuccess: false,
      processedData: null,
    });
  };

  const handleFileUpload = async (file: File, fileType: 'CSV' | 'Excel') => {
    setUploadState(prev => ({
      ...prev,
      isUploading: true,
      uploadError: null,
      uploadSuccess: false,
    }));

    try {
      const response = await api.uploadAnalyticsFile(file);
      
      if (response.success && response.data) {
        setUploadState(prev => ({
          ...prev,
          isUploading: false,
          uploadSuccess: true,
          processedData: response.data as unknown as ProcessedFileData,
        }));

        toast({
          title: "File uploaded successfully",
          description: `${fileType} file "${file.name}" has been processed and analyzed.`,
        });
      } else {
        throw new Error(response.error || 'Upload failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      setUploadState(prev => ({
        ...prev,
        isUploading: false,
        uploadError: errorMessage,
      }));

      toast({
        title: "Upload failed",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const uploadCSVFile = async (file: File) => {
    await handleFileUpload(file, 'CSV');
  };

  const uploadExcelFile = async (file: File) => {
    await handleFileUpload(file, 'Excel');
  };

  return {
    uploadState,
    uploadCSVFile,
    uploadExcelFile,
    resetUploadState,
  };
}