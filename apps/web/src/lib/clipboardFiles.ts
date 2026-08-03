export const getFilesFromClipboardData = (clipboardData: DataTransfer | null): File[] => {
  if (!clipboardData) return [];

  const files: File[] = [];

  if (clipboardData.items) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      if (clipboardData.items[i].kind === 'file') {
        const file = clipboardData.items[i].getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }
  } else if (clipboardData.files) {
    for (let i = 0; i < clipboardData.files.length; i++) {
      files.push(clipboardData.files[i]);
    }
  }

  return files;
};
