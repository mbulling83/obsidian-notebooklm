export interface NlmNotebook {
  id: string;
  title: string;
}

export interface NlmSource {
  id: string;
  title: string;
  sourceType?: number;
}

export interface NlmNote {
  id: string;
  title: string;
  content: string;
}

export interface RpcSession {
  rpcCall(methodId: string, params: unknown[], sourcePath?: string): Promise<unknown>;
}
