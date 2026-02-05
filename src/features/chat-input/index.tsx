import React, { useState } from 'react';
import { Input, Button, Form } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useChatStore } from '@/entities/chat/model/chat-store';
import { useThemeContext } from '@/app/providers/theme-provider';
import { PromptSelector } from '../prompt-selector';
import { FileUpload } from '../file-upload';
import type { Attachment } from '@/entities/chat/model/types';

interface ChatInputFormProps {
  onSendMessage: (message: string, attachments?: Attachment[]) => void;
  loading: boolean;
}

export const ChatInputForm: React.FC<ChatInputFormProps> = ({ onSendMessage, loading }) => {
  const [form] = Form.useForm();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const { theme } = useThemeContext();
  const isDark = theme === 'dark';

  const handleFinish = (values: { message: string }) => {
    if (values.message?.trim() || attachments.length > 0) {
      onSendMessage(values.message?.trim() || '', attachments.length > 0 ? attachments : undefined);
      form.resetFields();
      setAttachments([]);
    }
  };

  return (
    <div>
      <PromptSelector />
      <FileUpload attachments={attachments} onChange={setAttachments} disabled={loading} />
      <Form form={form} onFinish={handleFinish} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 4 }}>
        <Form.Item name="message" style={{ flex: 1, marginRight: 0, marginBottom: 0 }}>
          <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 5 }}
            placeholder="Введите ваше сообщение..."
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                form.submit();
              }
            }}
          />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button
            type="default"
            htmlType="submit"
            icon={<SendOutlined />}
            loading={loading}
            style={{
              border: isDark ? '1px solid #555555' : '1px solid #e5e5e5',
              background: isDark ? '#4a4a4a' : '#ffffff',
              color: isDark ? '#e8e8e8' : '#171717'
            }}
          />
        </Form.Item>
      </Form>
    </div>
  );
};
