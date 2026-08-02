export interface IGlobalExceptionFilterResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string | string[] | object;
  error?: string;
  stack?: string;
  additional_data: Record<string, string | number | undefined> | undefined;
}
