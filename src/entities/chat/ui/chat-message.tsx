import { Avatar, Space, Typography, Image, Tag } from 'antd';
import { UserOutlined, RobotOutlined, FilePdfOutlined, FileMarkdownOutlined } from '@ant-design/icons';
import { Message, Attachment } from '../model/types';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useThemeContext } from '@/app/providers/theme-provider';
import { useQuery } from '@tanstack/react-query';
import { getDatabaseModels } from '@/entities/models/api/models-api';
import { MODELS } from '@/shared/config/models.config';
import { supabase } from '@/shared/lib/supabase';
import './chat-message.css';

const { Text } = Typography;

const markdownComponents = {
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="table-scroll-wrapper">
      <table {...props}>{children}</table>
    </div>
  ),
};

interface ChatMessageProps {
  message: Message;
}

// Get model from usage_logs by message_id
// Prefer successful logs, otherwise get any log
const getModelFromUsageLogs = async (messageId: string): Promise<string | null> => {
  // First try to get successful log
  const { data: successData, error: successError } = await supabase
    .from('usage_logs')
    .select('model')
    .eq('message_id', messageId)
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!successError && successData?.model) {
    return successData.model;
  }

  // Fallback to any log if no successful one found
  const { data, error } = await supabase
    .from('usage_logs')
    .select('model')
    .eq('message_id', messageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data.model || null;
};

const AttachmentPreview: React.FC<{ attachments: Attachment[]; isDark: boolean }> = ({ attachments, isDark }) => {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
      {attachments.map((att, i) => {
        if (att.type === 'image' && att.data) {
          return (
            <Image
              key={i}
              src={`data:${att.mime_type};base64,${att.data}`}
              alt={att.name}
              style={{ maxWidth: 200, maxHeight: 200, borderRadius: 8 }}
              placeholder
            />
          );
        }
        if (att.type === 'pdf') {
          return (
            <Tag key={i} icon={<FilePdfOutlined />} color={isDark ? '#3a3a3a' : undefined}
              style={{ borderColor: isDark ? '#555' : undefined, color: isDark ? '#e0e0e0' : undefined }}>
              {att.name}
            </Tag>
          );
        }
        if (att.type === 'markdown') {
          return (
            <Tag key={i} icon={<FileMarkdownOutlined />} color={isDark ? '#3a3a3a' : undefined}
              style={{ borderColor: isDark ? '#555' : undefined, color: isDark ? '#e0e0e0' : undefined }}>
              {att.name}
            </Tag>
          );
        }
        return null;
      })}
    </div>
  );
};

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const { role, content, id, model, attachments } = message;
  const isUser = role === 'user';
  const { theme } = useThemeContext();
  const isDark = theme === 'dark';

  // Load models from database for getting display names
  const { data: dbModels } = useQuery({
    queryKey: ['databaseModels'],
    queryFn: getDatabaseModels,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Get model from usage_logs for assistant messages (fallback if model not in message)
  const { data: modelFromLogs } = useQuery({
    queryKey: ['messageModel', id],
    queryFn: () => getModelFromUsageLogs(id),
    enabled: !isUser && !!id && !model, // Only query if model is not already available
    staleTime: Infinity,
  });

  // Get model display name
  // Note: usage_logs.model stores model_id (text like "deepseek-chat"), not UUID
  const getModelDisplayName = (modelId: string | null | undefined): string | null => {
    if (!modelId) return null;
    
    // First try to find in database models by model_id (text field)
    // This is what's stored in usage_logs.model
    if (dbModels) {
      // dbModels from getDatabaseModels returns { id, name, provider }
      // We need to check if modelId matches the id field (which might be model_id in some cases)
      // But actually, we need to fetch models with model_id field to match properly
      // For now, try exact match on id first, then try to find by name similarity
      const dbModel = dbModels.find(m => m.id === modelId);
      if (dbModel) return dbModel.name;
    }
    
    // Fallback to config - check by id
    const configModel = MODELS.find(m => m.id === modelId);
    if (configModel) return configModel.name;
    
    // If still not found, modelId might be a model_id (text), try to find in config by matching
    // This handles cases where usage_logs.model stores model_id instead of UUID
    return null;
  };

  // Use model from message (loaded via getMessages) or from usage_logs query (fallback)
  const modelId = model || modelFromLogs || null;
  const modelDisplayName = !isUser ? getModelDisplayName(modelId) : null;

  const avatarStyle = {
    background: isDark ? '#4a4a4a' : '#f5f5f5',
    color: isDark ? '#e8e8e8' : '#171717',
    flexShrink: 0,
  };

  return (
    <div className={`message-wrapper ${isUser ? 'user' : 'assistant'}`}>
      {isUser ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', gap: 12 }}>
          <div className="message-bubble user-bubble">
            {attachments && attachments.length > 0 && (
              <AttachmentPreview attachments={attachments} isDark={isDark} />
            )}
            <div className="message-content">
              <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</Markdown>
            </div>
          </div>
          <Avatar icon={<UserOutlined />} style={avatarStyle} />
        </div>
      ) : (
        <Space align="start" size="small">
          <Avatar icon={<RobotOutlined />} style={avatarStyle} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {modelDisplayName && (
              <Text 
                type="secondary" 
                style={{ 
                  fontSize: '12px', 
                  fontWeight: 500,
                  color: isDark ? '#a0a0a0' : '#666666',
                  marginBottom: 4
                }}
              >
                Модель: {modelDisplayName}
              </Text>
            )}
            <div className="message-content">
              <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</Markdown>
            </div>
          </div>
        </Space>
      )}
    </div>
  );
};
