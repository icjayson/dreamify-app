export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  isError?: boolean;
  isInsufficientCredits?: boolean;
  attachment?: {
    kind: "csv" | "file";
    name: string;
    mime?: string;
    sourceType?: string;
    accountName?: string;
    propertyName?: string;
  };
  /** Charts referenced via @chart mention */
  chartMentions?: Array<{
    title: string;
    type: string;
    componentId: string;
  }>;
  template?: {
    id: string;
    title: string;
    description: string;
    image: string;
    category: string;
  };
  dashboardCard?: {
    sourceFileName: string;
    dashboardId: string;
    dashboardTitle?: string;
    accountName?: string;
    sourceType?: string;
  };
  todoTasks?: Array<{
    id: string;
    text: string;
  }>;
}