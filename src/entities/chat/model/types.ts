export type AttachmentType = 'image' | 'pdf' | 'markdown';

export interface Attachment {
  type: AttachmentType;
  name: string;
  mime_type: string;
  size: number;
  data?: string; // base64 для изображений/pdf, текст для markdown. Опционально — может отсутствовать для загруженных из БД.
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string | null; // model_id of the AI model that generated the response
  attachments?: Attachment[] | null;
}
