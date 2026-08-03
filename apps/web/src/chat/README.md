# Zustand Stores

This directory contains Zustand stores for managing shared state between components.

## Stores

### useChatStore
Manages all chat-related state and actions.

**State:**
- `inputValue`: Current input text
- `isTyping`: Whether AI is currently typing
- `messages`: Array of chat messages
- `uploadedFile`: Currently uploaded file information
- `dropdownOpen`: Whether data source dropdown is open
- `selectedDataSource`: Currently selected data source
- `isListening`: Whether speech recognition is active
- `transcript`: Current speech recognition transcript
- `detectedLanguage`: Detected language from speech recognition

**Actions:**
- `setInputValue(value)`: Set input text
- `setIsTyping(typing)`: Set typing state
- `setMessages(messages)`: Set messages array
- `addMessage(message)`: Add a new message
- `setUploadedFile(file)`: Set uploaded file
- `setDropdownOpen(open)`: Toggle dropdown
- `setSelectedDataSource(source)`: Set data source
- `sendMessage(content)`: Send a message and clear input
- `clearInput()`: Clear input text
- `resetChat()`: Reset all chat state

### useFileStore
Manages file upload and processing state.

**State:**
- `uploadState`: File upload status and data
- `attachedCsvName`: Name of attached CSV file
- `attachedCsvSummary`: Summary of CSV content
- `attachedCsvRaw`: Raw CSV content

**Actions:**
- `setUploadState(state)`: Update upload state
- `setAttachedCsvName(name)`: Set CSV file name
- `setAttachedCsvSummary(summary)`: Set CSV summary
- `setAttachedCsvRaw(raw)`: Set raw CSV content
- `uploadFile(file)`: Upload a file
- `removeFile(fileID)`: Remove uploaded file
- `processFile(fileID)`: Process uploaded file
- `clearAttachment()`: Clear all attachment data
- `validateClientFile(file)`: Validate file before upload
- `resetFileState()`: Reset all file state

## Usage

### In Components

```tsx
import { useChatStore } from '@/stores/useChatStore';
import { useFileStore } from '@/stores/useFileStore';

const MyComponent = () => {
  // Get specific state and actions
  const { inputValue, setInputValue, sendMessage } = useChatStore();
  const { uploadState, uploadFile } = useFileStore();

  const handleSubmit = () => {
    sendMessage(inputValue);
  };

  return (
    <div>
      <input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
      />
      <button onClick={handleSubmit}>Send</button>
    </div>
  );
};
```

### Data Persistence

The stores maintain state across component unmounts and remounts. When switching from HomePage to ChatInterface, all state is preserved:

- Input text remains in the textarea
- Uploaded files stay attached
- Selected data source is remembered
- Chat messages persist

### Testing

Run tests with:
```bash
npm test -- stores
```

## Benefits

1. **Shared State**: Both HomePage and ChatInterface use the same state
2. **Data Persistence**: State persists when switching between components
3. **Type Safety**: Full TypeScript support
4. **Performance**: Only re-renders components that use changed state
5. **Simplicity**: Easy to use and understand API
6. **Testing**: Easy to test with provided test utilities
