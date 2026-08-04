export async function settleProjectRefresh<T>(
  request: Promise<T>,
  fallback: () => T,
  reportError: (error: unknown) => void,
): Promise<T> {
  try {
    return await request;
  } catch (error) {
    reportError(error);
    return fallback();
  }
}
