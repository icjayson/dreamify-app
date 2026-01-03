import { api } from './api';
import { conversationService, ConversationChatRequest } from './conversationService';

export interface ProcessingResponse {
  success: boolean;
  data?: {
    success: boolean;
    status: 'not_processed' | 'processing' | 'completed' | 'error' | 'accepted';
    fileID: string;
    conversation_id?: string;
    message?: string;
    error?: string;
    processed_data?: any;
    dashboard_data?: any;
    [key: string]: any;
  };
}

class ProcessingService {
  async runProcessing(
    projectId: string,
    assetId: string | null,  // Allow null for Q&A without files
    prompt: string,
    conversationId?: string,
    additionalContents?: ConversationChatRequest['user_node_contents']
  ): Promise<ProcessingResponse> {
    try {
      const textContent: ConversationChatRequest['user_node_contents'][number] = {
        type: 'text',
        data: {
          text: prompt,
        },
      };

      const request: ConversationChatRequest = {
        conversation_id: conversationId,
        project_id: projectId,
        user_node_contents: [
          textContent,
          ...(additionalContents ?? []),
        ],
      };
      const response = await conversationService.sendChatMessage(request);
      return {
        success: true,
        data: {
          success: true,
          status: 'accepted',
          fileID: assetId || '',
          conversation_id: response.conversation_id,
        },
      };
    } catch (error) {
      return {
        success: false,
        data: {
          success: false,
          status: 'error',
          fileID: assetId || '',
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        },
      };
    }
  }

  async getWorkflowStatus(
    conversationId: string,
    projectId: string,
    abortSignal?: AbortSignal
  ): Promise<ProcessingResponse> {
    try {
      const workflowStatus = await conversationService.getWorkflowStatus(conversationId, projectId);
      return {
        success: true,
        data: {
          success: true,
          status: workflowStatus.status === 'completed' ? 'completed' : 
                  workflowStatus.status === 'error' ? 'error' : 
                  workflowStatus.status === 'stopped' ? 'stopped' : 'processing',
          fileID: '', // Not needed for workflow status
          conversation_id: conversationId,
          workflow_status: workflowStatus,
        },
      };
    } catch (error) {
      if (abortSignal?.aborted) {
        return {
          success: false,
          data: {
            success: false,
            status: 'error',
            fileID: '',
            conversation_id: conversationId,
            error: 'Request aborted',
          },
        };
      }
      return {
        success: false,
        data: {
          success: false,
          status: 'error',
          fileID: '',
          conversation_id: conversationId,
          error: error instanceof Error ? error.message : 'Unable to fetch workflow status',
        },
      };
    }
  }

  async pollProcessingStatus(
    assetId: string,
    projectId: string,
    conversationId?: string,
    onStatusUpdate?: (status: ProcessingResponse) => void,
    maxAttempts: number = 30,
    intervalMs: number = 5000,
    abortSignal?: AbortSignal
  ): Promise<ProcessingResponse> {
    if (!conversationId) {
      return {
        success: false,
        data: {
          success: false,
          status: 'error',
          fileID: assetId,
          error: 'Conversation ID is required for polling',
        },
      };
    }

    let attempts = 0;
    while (attempts < maxAttempts) {
      // Check if aborted before each iteration
      if (abortSignal?.aborted) {
        return {
          success: false,
          data: {
            success: false,
            status: 'error',
            fileID: assetId,
            conversation_id: conversationId,
            error: 'Polling aborted',
          },
        };
      }

      try {
        const status = await this.getWorkflowStatus(conversationId, projectId, abortSignal);
        if (onStatusUpdate) {
          onStatusUpdate(status);
        }

        const workflowStatus = status.data?.workflow_status?.status;
        
        if (workflowStatus === 'stopped') {
          return {
            success: true,
            data: {
              success: true,
              status: 'stopped',
              fileID: assetId,
              conversation_id: conversationId,
              message: 'Workflow stopped by user',
              workflow_status: status.data?.workflow_status,
            },
          };
        }
        
        if (workflowStatus === 'completed') {
          // Check response type from workflow status
          const responseType = status.data?.workflow_status?.metadata?.response_type;
          
          if (responseType === 'message' || !responseType) {
            // Q&A response or unknown - try to get dashboard, but don't fail if it doesn't exist
            try {
              const dashboardData = await conversationService.getDashboardData(conversationId, projectId);
              if (dashboardData) {
                return {
                  success: true,
                  data: {
                    success: true,
                    status: 'completed',
                    fileID: assetId,
                    conversation_id: conversationId,
                    dashboard_data: dashboardData.dashboard_data,
                  },
                };
              }
            } catch (error) {
              // Dashboard doesn't exist - this is OK for Q&A responses
              console.log('No dashboard found - this is expected for Q&A responses');
            }
            
            // Q&A response - return completed without dashboard_data
            return {
              success: true,
              data: {
                success: true,
                status: 'completed',
                fileID: assetId,
                conversation_id: conversationId,
                workflow_status: status.data?.workflow_status,
              },
            };
          } else {
            // Dashboard response - get dashboard data
            try {
              const dashboardData = await conversationService.getDashboardData(conversationId, projectId);
              if (dashboardData) {
                return {
                  success: true,
                  data: {
                    success: true,
                    status: 'completed',
                    fileID: assetId,
                    conversation_id: conversationId,
                    dashboard_data: dashboardData.dashboard_data,
                  },
                };
              } else {
                // Workflow completed but no dashboard (shouldn't happen, but handle gracefully)
                return {
                  success: true,
                  data: {
                    success: true,
                    status: 'completed',
                    fileID: assetId,
                    conversation_id: conversationId,
                  },
                };
              }
            } catch (error) {
              return {
                success: false,
                data: {
                  success: false,
                  status: 'error',
                  fileID: assetId,
                  conversation_id: conversationId,
                  error: error instanceof Error ? error.message : 'Unable to load dashboard data',
                },
              };
            }
          }
        }

        if (workflowStatus === 'error') {
          const errorMsg = status.data?.workflow_status?.metadata?.error || 'Processing failed';
          return {
            success: false,
            data: {
              success: false,
              status: 'error',
              fileID: assetId,
              conversation_id: conversationId,
              error: errorMsg,
            },
          };
        }

        // Continue polling if status is 'processing' or other intermediate states

      } catch (error) {
        return {
          success: false,
          data: {
            success: false,
            status: 'error',
            fileID: assetId,
            conversation_id: conversationId,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
          },
        };
      }

      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return {
      success: false,
      data: {
        success: false,
        status: 'error',
        fileID: assetId,
        conversation_id: conversationId,
        error: 'Processing timed out',
      },
    };
  }
}

export const processingService = new ProcessingService();
